module march;

__include shapes;

public struct Ray
{
    public float3 origin;
    public float3 direction;

    public float3 at(float t)
    {
        return origin + direction * t;
    }
}

public static const float MAX_DISTANCE = 40.0;

[Differentiable]
float evaluate<S : ISdf>(S sdf, float3 p)
{
    return sdf.distance(p);
}

public float3 surfaceNormal<S : ISdf>(S sdf, float3 p)
{
    var point = diffPair(p);
    bwd_diff(evaluate<S>)(sdf, point, 1.0);
    return normalize(point.d);
}

public Optional<float> march<S : ISdf>(S sdf, Ray ray)
{
    float t = 0.0;
    for (int i = 0; i < 160 && t < MAX_DISTANCE; i++)
    {
        float d = sdf.distance(ray.at(t));
        if (d < 0.0004 * (1.0 + t))
            return t;
        t += d;
    }
    return none;
}

public float softShadow<S : ISdf>(S sdf, Ray ray, float hardness)
{
    float light = 1.0;
    float t = 0.02;
    for (int i = 0; i < 48 && t < 12.0; i++)
    {
        float d = sdf.distance(ray.at(t));
        light = min(light, hardness * d / t);
        if (light < 0.001)
            break;
        t += clamp(d, 0.02, 0.4);
    }
    return saturate(light);
}

public float occlusion<S : ISdf>(S sdf, float3 p, float3 n)
{
    float blocked = 0.0;
    [ForceUnroll]
    for (int i = 1; i <= 5; i++)
    {
        float step = 0.06 * float(i);
        blocked += (step - sdf.distance(p + n * step)) / float(i);
    }
    return saturate(1.0 - 2.5 * blocked);
}
