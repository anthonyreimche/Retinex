// Stand-in for rtengine::Imagefloat: shmap.cc's update() names it; Retinex never calls it.
#pragma once
namespace rtengine
{
class Imagefloat
{
public:
    float r(int, int) const { return 0.f; }
    float g(int, int) const { return 0.f; }
    float b(int, int) const { return 0.f; }
};
}
