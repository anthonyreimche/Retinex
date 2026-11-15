// The members of RawTherapee 5.13's rtengine::RawImageSource (rawimagesource.h)
// that its Retinex functions touch, and the ICC store's working matrices.
// GPL-3.0-or-later. Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
#pragma once
#include <string>
#include "array2D.h"
#include "LUT.h"
#include "procparams.h"

namespace rtengine
{
struct Settings {
    bool verbose = false;
};
extern Settings* settings;

typedef const double(*TMatrix)[3];

class ICCStore
{
public:
    static ICCStore* getInstance();
    TMatrix workingSpaceMatrix(const std::string& name) const;
    TMatrix workingSpaceInverseMatrix(const std::string& name) const;
    double forward[3][3];
    double inverse[3][3];
};

class RawImageSource
{
public:
    array2D<float> red, green, blue;
    int W = 0, H = 0, border = 0;
    bool rgbSourceModified = false;

    void retinexPrepareBuffers(const procparams::ColorManagementParams& cmp, const procparams::RetinexParams &retinexParams, multi_array2D<float, 4> &conversionBuffer, LUTu &lhist16RETI);
    void retinexPrepareCurves(const procparams::RetinexParams &retinexParams, LUTf &cdcurve, LUTf &mapcurve, RetinextransmissionCurve &retinextransmissionCurve, RetinexgaintransmissionCurve &retinexgaintransmissionCurve, bool &retinexcontlutili, bool &mapcontlutili, bool &useHsl, LUTu & lhist16RETI, LUTu & histLRETI);
    void retinex(const procparams::ColorManagementParams& cmp, const procparams::RetinexParams &deh, const procparams::ToneCurveParams& Tc, LUTf & cdcurve, LUTf & mapcurve, const RetinextransmissionCurve & dehatransmissionCurve, const RetinexgaintransmissionCurve & dehagaintransmissionCurve, multi_array2D<float, 4> &conversionBuffer, bool dehacontlutili, bool mapcontlutili, bool useHsl, float &minCD, float &maxCD, float &mini, float &maxi, float &Tmean, float &Tsigma, float &Tmin, float &Tmax, LUTu &histLRETI);
    void MSR(float** luminance, float** originalLuminance, float **exLuminance, const LUTf& mapcurve, bool mapcontlutili, int width, int height, const procparams::RetinexParams &deh, const RetinextransmissionCurve & dehatransmissionCurve, const RetinexgaintransmissionCurve & dehagaintransmissionCurve, float &minCD, float &maxCD, float &mini, float &maxi, float &Tmean, float &Tsigma, float &Tmin, float &Tmax);
};
}
