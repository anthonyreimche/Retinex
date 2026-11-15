// Stand-in for rtengine::LabImage: shmap.cc's updateLab() names it; Retinex never calls it.
#pragma once
namespace rtengine
{
class LabImage
{
public:
    float** L = nullptr;
    float** a = nullptr;
    float** b = nullptr;
};
}
