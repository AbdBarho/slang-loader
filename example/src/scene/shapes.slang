implementing march;

public interface ISdf
{
    [Differentiable]
    float distance(float3 p);
}

[Differentiable]
public float smoothMin(float a, float b, float k)
{
    float h = saturate(0.5 + 0.5 * (b - a) / k);
    return lerp(b, a, h) - k * h * (1.0 - h);
}

public struct Sphere : ISdf
{
    public float3 center;
    public float radius;

    [Differentiable]
    public float distance(float3 p)
    {
        return length(p - center) - radius;
    }
}

public struct Torus : ISdf
{
    public float major;
    public float minor;

    [Differentiable]
    public float distance(float3 p)
    {
        return length(float2(length(p.xz) - major, p.y)) - minor;
    }
}

public struct RoundBox : ISdf
{
    public float3 size;
    public float radius;

    [Differentiable]
    public float distance(float3 p)
    {
        float3 q = abs(p) - size + radius;
        return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - radius;
    }
}

public struct Twisted<S : ISdf> : ISdf
{
    public S shape;
    public float rate;

    [Differentiable]
    public float distance(float3 p)
    {
        float angle = p.y * rate;
        float c = cos(angle);
        float s = sin(angle);
        return shape.distance(float3(c * p.x - s * p.z, p.y, s * p.x + c * p.z));
    }
}

public struct Rotated<S : ISdf> : ISdf
{
    public S shape;
    public float3x3 rotation;

    [Differentiable]
    public float distance(float3 p)
    {
        return shape.distance(mul(rotation, p));
    }
}
