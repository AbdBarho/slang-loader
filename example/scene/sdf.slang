public float smoothUnion(float a, float b, float k)
{
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return lerp(b, a, h) - k * h * (1.0 - h);
}

public struct Scene
{
    public float time;

    public float distance(float3 p)
    {
        float3 wobble = float3(sin(time * 0.9) * 0.6, sin(time * 1.3) * 0.35, 0.0);
        float blob = length(p - wobble) - 0.75;

        float3 q = abs(p) - 0.55;
        float box = length(max(q, 0.0)) - 0.18;

        float ground = p.y + 1.1;

        return min(ground, smoothUnion(blob, box, 0.55));
    }

    public float3 normal(float3 p)
    {
        float2 e = float2(0.0008, 0.0);
        return normalize(float3(
            distance(p + e.xyy) - distance(p - e.xyy),
            distance(p + e.yxy) - distance(p - e.yxy),
            distance(p + e.yyx) - distance(p - e.yyx)));
    }
};
