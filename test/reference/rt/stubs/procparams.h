// RawTherapee 5.13's RetinexParams (procparams.h/.cc) and the two other
// parameter blocks Retinex reads. GPL-3.0-or-later.
// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
#pragma once
#include <string>
#include <vector>
#include "curves.h"

namespace rtengine
{
namespace procparams
{
struct RetinexParams {
    bool enabled = false;
    std::vector<double> cdcurve, cdHcurve, lhcurve, transmissionCurve, gaintransmissionCurve, mapcurve;
    int str, scal, iter, grad, grads;
    double gam, slope;
    int neigh, offs, highlights, htonalwidth, shadows, stonalwidth, radius;
    std::string complexmethod, retinexMethod, retinexcolorspace, gammaretinex, mapMethod, viewMethod;
    int vart, limd, highl, skal;
    bool medianmap;

    // procparams.cc:792-797
    void getCurves(RetinextransmissionCurve &transmissionCurveLUT, RetinexgaintransmissionCurve &gaintransmissionCurveLUT) const
    {
        transmissionCurveLUT.Set(this->transmissionCurve);
        gaintransmissionCurveLUT.Set(this->gaintransmissionCurve);
    }
};
struct ColorManagementParams {
    std::string workingProfile;
};
struct ToneCurveParams {
    bool hrenabled = false;
};
}
}
