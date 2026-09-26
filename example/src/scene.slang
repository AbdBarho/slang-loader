import scene.march;

uniform float2 resolution;
uniform float time;

[format("rgba16f")]
WTexture2D<float4> target;

Texture2D<float4> image;
SamplerState imageSampler;

static const float3 SUN = normalize(float3(0.6, 0.55, -0.5));
static const float3 SUN_COLOUR = float3(0.85, 0.7, 0.55);
static const float3 MOON_COLOURS[3] = {
    float3(1.0, 0.22, 0.06),
    float3(0.06, 0.55, 1.0),
    float3(0.55, 0.12, 1.0),
};

struct Plane
{
    float height;
}

extension Plane : ISdf
{
    [Differentiable]
    float distance(float3 p)
    {
        return p.y - height;
    }
}

enum Material
{
    Floor,
    Chrome,
    Glow,
}

struct Surface
{
    Material kind;
    float3 albedo;
}

float3x3 rotationX(float angle)
{
    float c = cos(angle);
    float s = sin(angle);
    return float3x3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

float3x3 rotationZ(float angle)
{
    float c = cos(angle);
    float s = sin(angle);
    return float3x3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}

struct Scene : ISdf
{
    Plane ground;
    Twisted<RoundBox> pillar;
    Rotated<Torus> halo;
    Sphere moons[3];

    __init(float time)
    {
        ground = { -1.3 };
        pillar = { { float3(0.42, 1.0, 0.42), 0.1 }, 1.4 * sin(time * 0.4) };
        halo = { { 1.05, 0.06 }, mul(rotationX(time * 0.7), rotationZ(0.5)) };

        [ForceUnroll]
        for (int i = 0; i < 3; i++)
        {
            float phase = time * (0.6 + 0.15 * float(i)) + float(i) * 2.094;
            float3 orbit = float3(cos(phase) * 1.55, sin(phase * 1.7) * 0.6, sin(phase) * 1.55);
            moons[i] = { orbit, 0.2 + 0.04 * float(i) };
        }
    }

    [Differentiable]
    float solid(float3 p)
    {
        return smoothMin(pillar.distance(p), halo.distance(p), 0.2);
    }

    float glow(float3 p, out int nearest)
    {
        float best = MAX_DISTANCE;
        nearest = 0;
        [ForceUnroll]
        for (int i = 0; i < 3; i++)
        {
            float d = moons[i].distance(p);
            if (d < best)
            {
                best = d;
                nearest = i;
            }
        }
        return best;
    }

    [Differentiable]
    float distance(float3 p)
    {
        float body = solid(p);
        [ForceUnroll]
        for (int i = 0; i < 3; i++)
            body = smoothMin(body, moons[i].distance(p), 0.35);
        return min(body, ground.distance(p));
    }

    Surface surfaceAt(float3 p)
    {
        int moon;
        float glowing = glow(p, moon);
        float body = solid(p);

        if (ground.distance(p) < min(body, glowing))
        {
            int2 cell = int2(floor(p.xz * 1.25));
            float shade = ((cell.x + cell.y) & 1) != 0 ? 0.32 : 0.1;
            return { Material.Floor, float3(shade) };
        }

        if (glowing < body)
            return { Material.Glow, MOON_COLOURS[moon] };

        return { Material.Chrome, float3(0.9, 0.92, 0.96) };
    }
}

float3 sky(float3 direction)
{
    float3 colour = lerp(float3(0.3, 0.17, 0.22), float3(0.015, 0.02, 0.06), sqrt(saturate(direction.y)));
    float sun = max(dot(direction, SUN), 0.0);
    return colour + SUN_COLOUR * (pow(sun, 600.0) * 12.0 + pow(sun, 6.0) * 0.2);
}

float3 moonLight(Scene scene, float3 p, float3 n)
{
    float3 light = 0.0;
    [ForceUnroll]
    for (int i = 0; i < 3; i++)
    {
        float3 toMoon = scene.moons[i].center - p;
        float falloff = 1.0 / (1.0 + 3.0 * dot(toMoon, toMoon));
        light += MOON_COLOURS[i] * max(dot(n, normalize(toMoon)), 0.0) * falloff * 1.6;
    }
    return light;
}

float3 lighting(Scene scene, Surface surface, float3 p, float3 n, float3 view)
{
    Ray toSun = { p + n * 0.003, SUN };
    float shadow = softShadow(scene, toSun, 10.0);
    float ao = occlusion(scene, p, n);
    float diffuse = max(dot(n, SUN), 0.0) * shadow;
    float specular = pow(max(dot(n, normalize(SUN - view)), 0.0), 80.0) * shadow;
    float3 ambient = sky(n) * 0.5 * ao;
    float3 local = moonLight(scene, p, n) * ao;

    switch (surface.kind)
    {
    case Material.Floor:
        return surface.albedo * (diffuse * SUN_COLOUR + ambient + local);
    default:
        return surface.albedo * (0.25 * diffuse * SUN_COLOUR + 0.3 * ambient + local) + specular * SUN_COLOUR * 2.0;
    }
}

float reflectivity(Material kind, float3 n, float3 view)
{
    float fresnel = pow(1.0 - saturate(dot(n, -view)), 5.0);
    return kind == Material.Floor ? 0.08 + 0.5 * fresnel : 0.75 + 0.25 * fresnel;
}

float3 trace(Scene scene, Ray ray)
{
    float3 colour = 0.0;
    float3 throughput = 1.0;

    for (int bounce = 0; bounce < 3; bounce++)
    {
        if (let t = march(scene, ray))
        {
            float3 p = ray.at(t);
            Surface surface = scene.surfaceAt(p);
            float haze = exp(-0.0012 * t * t);

            if (surface.kind == Material.Glow)
            {
                colour += throughput * lerp(sky(ray.direction), surface.albedo * 1.8, haze);
                break;
            }

            float3 n = surfaceNormal(scene, p);
            float3 lit = lighting(scene, surface, p, n, ray.direction);
            colour += throughput * lerp(sky(ray.direction), lit, haze);

            throughput *= reflectivity(surface.kind, n, ray.direction) * haze;
            if (all(throughput < 0.01))
                break;

            ray = { p + n * 0.004, reflect(ray.direction, n) };
        }
        else
        {
            colour += throughput * sky(ray.direction);
            break;
        }
    }

    return colour;
}

Ray camera(float2 uv)
{
    float angle = time * 0.15;
    float3 eye = float3(sin(angle) * 4.8, 0.7 + 0.3 * sin(time * 0.23), cos(angle) * 4.8);
    float3 forward = normalize(float3(0.0, -0.15, 0.0) - eye);
    float3 right = normalize(cross(float3(0.0, 1.0, 0.0), forward));
    float3 up = cross(forward, right);
    return { eye, normalize(forward * 1.9 + right * uv.x + up * uv.y) };
}

[shader("compute")]
[numthreads(8, 8, 1)]
void renderMain(uint3 id: SV_DispatchThreadID)
{
    if (any(id.xy >= uint2(resolution)))
        return;

    float2 uv = (float2(id.xy) + 0.5) / resolution * 2.0 - 1.0;
    uv.x *= resolution.x / resolution.y;
    uv.y = -uv.y;

    let scene = Scene(time);
    target.Store(id.xy, float4(trace(scene, camera(uv)), 1.0));
}

struct Varyings
{
    float4 position : SV_Position;
    float2 uv;
};

[shader("vertex")]
Varyings vertexMain(uint id: SV_VertexID)
{
    float2 corner = float2(float((id << 1) & 2), float(id & 2));

    Varyings out;
    out.uv = float2(corner.x, 1.0 - corner.y);
    out.position = float4(corner * 2.0 - 1.0, 0.0, 1.0);
    return out;
}

float3 aces(float3 x)
{
    return saturate((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
}

[shader("fragment")]
float4 presentMain(Varyings varyings) : SV_Target
{
    float2 uv = varyings.uv;
    float2 centred = uv - 0.5;
    float2 fringe = centred * 0.006;
    float3 hdr = float3(
        image.Sample(imageSampler, uv + fringe).r,
        image.Sample(imageSampler, uv).g,
        image.Sample(imageSampler, uv - fringe).b);

    float vignette = 1.0 - 0.9 * dot(centred, centred);
    return float4(pow(aces(hdr * 1.1) * vignette, float3(1.0 / 2.2)), 1.0);
}
