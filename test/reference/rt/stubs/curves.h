// The part of RawTherapee 5.13's rtengine/curves.h that Retinex needs: the
// curve classes (curves.h 411-582, verbatim, via curves-classes.inc) and the
// CurveFactory members they and diagonalCurve2Lut use (curves.h 134-182).
// GPL-3.0-or-later. Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
#pragma once
#include <map>
#include <string>
#include <vector>
#include "rt_math.h"
#include "flatcurvetypes.h"
#include "diagonalcurvetypes.h"
#include "noncopyable.h"
#include "LUT.h"
#include "sleef.h"

#define CURVES_MIN_POLY_POINTS  1000

namespace rtengine
{
class CurveFactory
{
public:
    // curves.h:134-182, verbatim
    static inline double basel(double x, double m1, double m2)
    {
        if (x == 0.0) {
            return 0.0;
        }

        double k = sqrt((m1 - 1.0) * (m1 - m2) * 0.5) / (1.0 - m2);
        double l = (m1 - m2) / (1.0 - m2) + k;
        double lx = xlog(x);
        return m2 * x + (1.0 - m2) * (2.0 - xexp(k * lx)) * xexp(l * lx);
    }
    static inline double basel_alt(double x)
    {
        return (2.0 - x) * x * x * x;
    }
    // basic concave function between (0,0) and (1,1). m1 and m2 controls the slope at the start and end point
    static inline double baseu(double x, double m1, double m2)
    {
        return 1.0 - basel(1.0 - x, m1, m2);
    }
    static inline double baseu_alt(double x)
    {
        return x * (2.0 + (x - 2.0) * x * x);
    }
    // convex curve between (0,0) and (1,1) with slope m at (0,0). hr controls the highlight recovery
    static inline double cupper(double x, double m, double hr)
    {
        if (hr > 1.0) {
            return baseu(x, m, 2.0 * (hr - 1.0) / m);
        }

        double x1 = (1.0 - hr) / m;
        double x2 = x1 + hr;

        if (x >= x2) {
            return 1.0;
        }

        if (x < x1) {
            return x * m;
        }

        return 1.0 - hr + hr * baseu((x - x1) / hr, m, 0);
    }
    // concave curve between (0,0) and (1,1) with slope m at (1,1). sr controls the shadow recovery
    static inline double clower(double x, double m, double sr)
    {
        return 1.0 - cupper(1.0 - x, m, sr);
    }
    static bool diagonalCurve2Lut(const std::vector<double>& curvePoints, LUTf & curve, int skip, const LUTu & histogram, LUTu & outBeforeCurveHistogram);
    static bool diagonalCurve2Lut(const std::vector<double>& curvePoints, LUTf & curve, int skip);
};
#include "curves-classes.inc"
}
