struct Uniforms
{
    float2 resolution;
    float time;
};

ConstantBuffer<Uniforms> uniforms;

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
    out.uv = corner;
    out.position = float4(corner * 2.0 - 1.0, 0.0, 1.0);
    return out;
}

float smoothUnion(float a, float b, float k)
{
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return lerp(b, a, h) - k * h * (1.0 - h);
}

struct Scene
{
    float time;

    float distance(float3 p)
    {
        float3 wobble = float3(sin(time * 0.9) * 0.6, sin(time * 1.3) * 0.35, 0.0);
        float blob = length(p - wobble) - 0.75;

        float3 q = abs(p) - 0.55;
        float box = length(max(q, 0.0)) - 0.18;

        float ground = p.y + 1.1;

        return min(ground, smoothUnion(blob, box, 0.55));
    }

    float3 normal(float3 p)
    {
        float2 e = float2(0.0008, 0.0);
        return normalize(float3(
            distance(p + e.xyy) - distance(p - e.xyy),
            distance(p + e.yxy) - distance(p - e.yxy),
            distance(p + e.yyx) - distance(p - e.yyx)));
    }
};

[shader("fragment")]
float4 fragmentMain(Varyings varyings) : SV_Target
{
    float2 uv = varyings.uv * 2.0 - 1.0;
    uv.x *= uniforms.resolution.x / uniforms.resolution.y;
    uv.y = -uv.y;

    Scene scene = { uniforms.time };

    float angle = uniforms.time * 0.35;
    float3 eye = float3(sin(angle) * 3.4, 1.1, cos(angle) * 3.4);
    float3 forward = normalize(-eye);
    float3 right = normalize(cross(float3(0.0, 1.0, 0.0), forward));
    float3 up = cross(forward, right);
    float3 ray = normalize(forward * 1.7 + right * uv.x + up * uv.y);

    float travelled = 0.0;
    bool hit = false;
    for (int i = 0; i < 96; i++)
    {
        float3 p = eye + ray * travelled;
        float d = scene.distance(p);
        if (d < 0.001)
        {
            hit = true;
            break;
        }
        if (travelled > 24.0)
            break;
        travelled += d;
    }

    float3 sky = lerp(float3(0.05, 0.06, 0.10), float3(0.16, 0.20, 0.32), varyings.uv.y);
    float3 colour = sky;

    if (hit)
    {
        float3 p = eye + ray * travelled;
        float3 n = scene.normal(p);
        float3 lightDir = normalize(float3(0.7, 0.9, -0.4));

        float diffuse = max(dot(n, lightDir), 0.0);
        float rim = pow(1.0 - max(dot(n, -ray), 0.0), 2.5);

        float3 base = lerp(float3(0.85, 0.32, 0.45), float3(0.25, 0.55, 0.95), 0.5 + 0.5 * n.y);
        colour = base * (0.15 + 0.85 * diffuse) + rim * float3(0.5, 0.7, 1.0);
        colour = lerp(colour, sky, saturate(travelled / 24.0));
    }

    colour = pow(saturate(colour), float3(1.0 / 2.2));
    return float4(colour, 1.0);
}
