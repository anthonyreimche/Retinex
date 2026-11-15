// The parts of RawTherapee 5.13's rtengine::Color that Retinex calls, with
// their bodies copied from rtengine/color.h and rtengine/color.cc
// (commit 1924179). GPL-3.0-or-later.
// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
//
// Only what MSR and RawImageSource::retinex* reach is here; the class is
// otherwise RawTherapee's, member for member.

#pragma once

#include <array>
#include <cmath>

#include "rt_math.h"
#include "LUT.h"
#include "sleef.h"

namespace rtengine
{

typedef std::array<double, 7> GammaValues;

class Color
{
public:
    constexpr static double eps = 216.0 / 24389.0;
    constexpr static double eps_max = MAXVALD * eps;
    constexpr static double kappa = 24389.0 / 27.0;
    constexpr static double kappaInv = 27.0 / 24389.0;
    constexpr static double epsilonExpInv3 = 6.0 / 29.0;

    constexpr static float epsf = eps;
    constexpr static float kappaf = kappa;
    constexpr static float kappaInvf = kappaInv;
    constexpr static float epsilonExpInv3f = epsilonExpInv3;

    constexpr static float D50x = 0.9642f;
    constexpr static float D50z = 0.8249f;
    constexpr static double epskap = 8.0;
    constexpr static float epskapf = epskap;

    constexpr static float c1By116 = 1.0 / 116.0;
    constexpr static float c16By116 = 16.0 / 116.0;

    static LUTf cachef;
    static LUTf cachefy;
    static LUTf gammatab_13_2;
    static LUTf igammatab_13_2;
    static LUTf gammatab_115_2;
    static LUTf igammatab_115_2;
    static LUTf gammatab_145_3;
    static LUTf igammatab_145_3;

    static void init();

    // color.h:177-186
    static inline float computeXYZ2LabY(float f)
    {
        if (f < 0.f) {
            return 327.68f * (kappa * f / MAXVALF);
        } else if (f > 65535.f) {
            return 327.68f * (116.f * xcbrtf(f / MAXVALF) - 16.f);
        } else {
            return cachefy[f];
        }
    }

    // color.cc:1715-1724
    static float computeXYZ2Lab(float f)
    {
        if (f < 0.f) {
            return 327.68 * ((kappa * f / MAXVALF + 16.0) / 116.0);
        } else if (f > 65535.f) {
            return (327.68f * xcbrtf(f / MAXVALF));
        } else {
            return cachef[f];
        }
    }

    // color.h:273-306
    static inline void rgb2hslfloat(float r, float g, float b, float &h, float &s, float &l)
    {

        float minVal = min(r, g, b);
        float maxVal = max(r, g, b);
        float C = maxVal - minVal;

        l = (maxVal + minVal) * 7.6295109e-6f; // (0.5f / 65535.f)

        if (C < 0.65535f) { // 0.00001f * 65535.f
            h = 0.f;
            s = 0.f;
        } else {

            if (l <= 0.5f) {
                s = C / (maxVal + minVal);
            } else {
                s = C / (131070.f - (maxVal + minVal)); // 131070.f = 2.f * 65535.f
            }

            if ( r == maxVal ) {
                h = (g - b);
            } else if ( g == maxVal ) {
                h = (2.f * C) + (b - r);
            } else {
                h = (4.f * C) + (r - g);
            }

            h /= (6.f * C);

            if ( h < 0.f ) {
                h += 1.f;
            }
        }
    }

    // color.cc:629-650
    static void rgb2hsl(vfloat r, vfloat g, vfloat b, vfloat &h, vfloat &s, vfloat &l)
    {
        vfloat maxv = vmaxf(r, vmaxf(g, b));
        vfloat minv = vminf(r, vminf(g, b));
        vfloat C = maxv - minv;
        vfloat tempv = maxv + minv;
        l = (tempv) * F2V(7.6295109e-6f);
        s = (maxv - minv);
        s /= vself(vmaskf_gt(l, F2V(0.5f)), F2V(131070.f) - tempv, tempv);

        h = F2V(4.f) * C + r - g;
        h = vself(vmaskf_eq(g, maxv), F2V(2.f) * C + b - r, h);
        h = vself(vmaskf_eq(r, maxv), g - b, h);

        h /= (F2V(6.f) * C);
        vfloat onev = F2V(1.f);
        h = vself(vmaskf_lt(h, ZEROV), h + onev, h);

        vmask zeromask = vmaskf_lt(C, F2V(0.65535f));
        h = vself(zeromask, ZEROV, h);
        s = vself(zeromask, ZEROV, s);
    }

    // color.cc:672-689
    static float hue2rgbfloat(float p, float q, float t)
    {
        if (t < 0.f) {
            t += 6.f;
        } else if( t > 6.f) {
            t -= 6.f;
        }

        if      (t < 1.f) {
            return p + (q - p) * t;
        } else if (t < 3.f) {
            return q;
        } else if (t < 4.f) {
            return p + (q - p) * (4.f - t);
        } else {
            return p;
        }
    }

    // color.cc:692-706
    static vfloat hue2rgb(vfloat p, vfloat q, vfloat t)
    {
        vfloat fourv = F2V(4.f);
        vfloat threev = F2V(3.f);
        vfloat sixv = threev + threev;
        t = vself(vmaskf_lt(t, ZEROV), t + sixv, t);
        t = vself(vmaskf_gt(t, sixv), t - sixv, t);

        vfloat temp1 = p + (q - p) * t;
        vfloat temp2 = p + (q - p) * (fourv - t);
        vfloat result = vself(vmaskf_lt(t, fourv), temp2, p);
        result = vself(vmaskf_lt(t, threev), q, result);
        return vself(vmaskf_lt(t, fourv - threev), temp1, result);
    }

    // color.h:324-344
    static inline void hsl2rgbfloat (float h, float s, float l, float &r, float &g, float &b)
    {

        if (s == 0.f) {
            r = g = b = 65535.f * l;    //  achromatic
        } else {
            float m2;

            if (l <= 0.5f) {
                m2 = l * (1.f + s);
            } else {
                m2 = l + s - l * s;
            }

            float m1 = 2.f * l - m2;

            r = 65535.f * hue2rgbfloat (m1, m2, h * 6.f + 2.f);
            g = 65535.f * hue2rgbfloat (m1, m2, h * 6.f);
            b = 65535.f * hue2rgbfloat (m1, m2, h * 6.f - 2.f);
        }
    }

    // color.cc:734-755
    static void hsl2rgb (vfloat h, vfloat s, vfloat l, vfloat &r, vfloat &g, vfloat &b)
    {

        vfloat m2 = s * l;
        m2 = vself(vmaskf_gt(l, F2V(0.5f)), s - m2, m2);
        m2 += l;

        vfloat twov = F2V(2.f);
        vfloat c65535v = F2V(65535.f);
        vfloat m1 = l + l - m2;

        h *= F2V(6.f);
        r = c65535v * hue2rgb (m1, m2, h + twov);
        g = c65535v * hue2rgb (m1, m2, h);
        b = c65535v * hue2rgb (m1, m2, h - twov);

        vmask selectsMask = vmaskf_eq(ZEROV, s);
        vfloat lc65535v = c65535v * l;
        r = vself(selectsMask, lc65535v, r);
        g = vself(selectsMask, lc65535v, g);
        b = vself(selectsMask, lc65535v, b);
    }

    // color.cc:1035-1040
    static void rgbxyz (float r, float g, float b, float &x, float &y, float &z, const float xyz_rgb[3][3])
    {
        x = ((xyz_rgb[0][0] * r + xyz_rgb[0][1] * g + xyz_rgb[0][2] * b)) ;
        y = ((xyz_rgb[1][0] * r + xyz_rgb[1][1] * g + xyz_rgb[1][2] * b)) ;
        z = ((xyz_rgb[2][0] * r + xyz_rgb[2][1] * g + xyz_rgb[2][2] * b)) ;
    }

    // color.cc:1874-1889
    static void XYZ2Lab(float X, float Y, float Z, float &L, float &a, float &b)
    {

        float x = X / D50x;
        float z = Z / D50z;
        float y = Y;
        float fx, fy, fz;

        fx = computeXYZ2Lab(x);
        fy = computeXYZ2Lab(y);
        fz = computeXYZ2Lab(z);

        L = computeXYZ2LabY(y);
        a = (500.0f * (fx - fy) );
        b = (200.0f * (fy - fz) );
    }

    // color.h:754-770
    static inline float f2xyz(float f)
    {
        return (f > epsilonExpInv3f) ? f * f * f : (116.f * f - 16.f) * kappaInvf;
    }
    static inline vfloat f2xyz(vfloat f)
    {
        const vfloat epsilonExpInv3v = F2V(epsilonExpInv3f);
        const vfloat kappaInvv = F2V(kappaInvf);
        vfloat res1 = f * f * f;
        vfloat res2 = (F2V(116.f) * f - F2V(16.f)) * kappaInvv;
        return vself(vmaskf_gt(f, epsilonExpInv3v), res1, res2);
    }

    // color.h:624-660
    static inline void Lab2XYZ(float L, float a, float b, float &x, float &y, float &z)
    {
        float LL = L / 327.68f;
        float aa = a / 327.68f;
        float bb = b / 327.68f;
        float fy = (c1By116 * LL) + c16By116; // (L+16)/116
        float fx = (0.002f * aa) + fy;
        float fz = fy - (0.005f * bb);
        x = 65535.f * f2xyz(fx) * D50x;
        z = 65535.f * f2xyz(fz) * D50z;
        y = (LL > epskapf) ? 65535.f * fy * fy * fy : 65535.f * LL / kappaf;
    }
    static inline void Lab2XYZ(vfloat L, vfloat a, vfloat b, vfloat &x, vfloat &y, vfloat &z)
    {
        vfloat c327d68 = F2V(327.68f);
        L /= c327d68;
        a /= c327d68;
        b /= c327d68;
        vfloat fy = F2V(c1By116) * L + F2V(c16By116);
        vfloat fx = F2V(0.002f) * a + fy;
        vfloat fz = fy - (F2V(0.005f) * b);
        vfloat c65535 = F2V(65535.f);
        x = c65535 * f2xyz(fx) * F2V(D50x);
        z = c65535 * f2xyz(fz) * F2V(D50z);
        vfloat res1 = fy * fy * fy;
        vfloat res2 = L / F2V(kappa);
        y = vself(vmaskf_gt(L, F2V(epskap)), res1, res2);
        y *= c65535;
    }

    // color.cc:1051-1071
    static void xyz2rgb (float x, float y, float z, float &r, float &g, float &b, const double rgb_xyz[3][3])
    {
        r = ((rgb_xyz[0][0] * x + rgb_xyz[0][1] * y + rgb_xyz[0][2] * z)) ;
        g = ((rgb_xyz[1][0] * x + rgb_xyz[1][1] * y + rgb_xyz[1][2] * z)) ;
        b = ((rgb_xyz[2][0] * x + rgb_xyz[2][1] * y + rgb_xyz[2][2] * z)) ;
    }
    // color.h:590-597
    static inline void xyz2rgb (vfloat x, vfloat y, vfloat z, vfloat &r, vfloat &g, vfloat &b, const vfloat rgb_xyz[3][3])
    {
        r = ((rgb_xyz[0][0] * x + rgb_xyz[0][1] * y + rgb_xyz[0][2] * z)) ;
        g = ((rgb_xyz[1][0] * x + rgb_xyz[1][1] * y + rgb_xyz[1][2] * z)) ;
        b = ((rgb_xyz[2][0] * x + rgb_xyz[2][1] * y + rgb_xyz[2][2] * z)) ;
    }

    // color.h:1254-1291
    static inline double gamma13_2     (double x)
    {
        return x <= 0.016613 ? x * 2.0 : 1.009968 * exp(log(x) / 1.3) - 0.009968;
    }
    static inline double igamma13_2    (double x)
    {
        return x <= 0.033226 ? x / 2.0 : exp(log((x + 0.009968) / 1.009968) * 1.3);
    }
    static inline double gamma115_2     (double x)
    {
        return x <= 0.001692 ? x * 2.0 : 1.000508 * exp(log(x) / 1.15) - 0.000508;
    }
    static inline double igamma115_2    (double x)
    {
        return x <= 0.003384 ? x / 2.0 : exp(log((x + 0.000508) / 1.000508) * 1.15);
    }
    static inline double gamma145_3     (double x)
    {
        return x <= 0.009115 ? x * 3.0 : 1.012305 * exp(log(x) / 1.45) - 0.012305;
    }
    static inline double igamma145_3    (double x)
    {
        return x <= 0.027345 ? x / 3.0 : exp(log((x + 0.012305) / 1.012305) * 1.45);
    }
    static inline double gammareti      (double x, double gamma, double start, double slope, double mul, double add)
    {
        return (x <= start ? x*slope : exp(log(x) / gamma) * mul - add);
    }
    static inline double igammareti     (double x, double gamma, double start, double slope, double mul, double add)
    {
        return (x <= start * slope ? x / slope : exp(log((x + add) / mul) * gamma) );
    }

    // color.cc:1578-1622
    static void calcGamma (double pwr, double ts, GammaValues &gamma)
    {
        //from Dcraw (D.Coffin)
        double g[6], bnd[2] = {};

        g[0] = pwr;
        g[1] = ts;
        g[2] = g[3] = g[4] = 0.;
        bnd[g[1] >= 1.] = 1.;

        if (g[1] && (g[1] - 1.) * (g[0] - 1.) <= 0.) {
            for (int i = 0; i < 99; i++) {
                g[2] = (bnd[0] + bnd[1]) / 2.;

                if (g[0]) {
                    bnd[(pow(g[2] / g[1], -g[0]) - 1.) / g[0] - 1. / g[2] > -1.] = g[2];
                } else {
                    bnd[g[2] / exp(1. - 1. / g[2]) < g[1]] = g[2];
                }
            }

            g[3] = g[2] / g[1];

            if (g[0]) {
                g[4] = g[2] * (1. / g[0] - 1.);
            }
        }

        if (g[0]) {
            g[5] = 1. / (g[1] * SQR(g[3]) / 2. - g[4] * (1. - g[3]) + (1. - pow(g[3], 1. + g[0])) * (1. + g[4]) / (1. + g[0])) - 1.;
        } else {
            g[5] = 1. / (g[1] * SQR(g[3]) / 2. + 1. - g[2] - g[3] - g[2] * g[3] * (log(g[3]) - 1.)) - 1.;
        }

        gamma[0] = g[0];
        gamma[1] = g[1];
        gamma[2] = g[2];
        gamma[3] = g[3];
        gamma[4] = g[4];
        gamma[5] = g[5];
        gamma[6] = 0.;
    }

    // color.h:1914-1947
    static inline double huelab_to_huehsv2 (float HH)
    {
        double hr = 0.0;

        if      (HH >= 0.f       && HH < 0.6f    ) {
            hr = 0.11666 * double(HH) + 0.93;
        } else if (HH >= 0.6f      && HH < 1.4f    ) {
            hr = 0.1125 * double(HH) - 0.0675;
        } else if (HH >= 1.4f      && HH < 2.f     ) {
            hr = 0.2666 * double(HH) - 0.2833;
        } else if (HH >= 2.f       && HH < 3.14159f) {
            hr = 0.1489 * double(HH) - 0.04785;
        } else if (HH >= -3.14159f && HH < -2.8f   ) {
            hr = 0.23419 * double(HH) + 1.1557;
        } else if (HH >= -2.8f     && HH < -2.3f   ) {
            hr = 0.16   * double(HH) + 0.948;
        } else if (HH >= -2.3f     && HH < -0.9f   ) {
            hr = 0.12143 * double(HH) + 0.85928;
        } else if (HH >= -0.9f     && HH < -0.1f   ) {
            hr = 0.2125 * double(HH) + 0.94125;
        } else if (HH >= -0.1f     && HH < 0.f     ) {
            hr = 0.1    * double(HH) + 0.93;
        }
        if     (hr < 0.0) {
            hr += 1.0;
        } else if(hr > 1.0) {
            hr -= 1.0;
        }

        return (hr);
    }

    // color.cc:2916-3008
    static void gamutLchonly (float HH, float2 sincosval, float &Lprov1, float &Chprov1, float &R, float &G, float &B, const double wip[3][3], const bool isHLEnabled, const float lowerCoef, const float higherCoef)
    {
        constexpr float ClipLevel = 65535.0f;
        bool inGamut;
        float ChprovSave = Chprov1;

        do {
            inGamut = true;

            float aprov1 = Chprov1 * sincosval.y;
            float bprov1 = Chprov1 * sincosval.x;

            float fy = (c1By116 * Lprov1 ) + c16By116;
            float fx = (0.002f * aprov1) + fy;
            float fz = fy - (0.005f * bprov1);

            float x_ = 65535.0f * f2xyz(fx) * D50x;
            float z_ = 65535.0f * f2xyz(fz) * D50z;
            float y_ = (Lprov1 > epskap) ? 65535.0f * fy * fy * fy : 65535.0f * Lprov1 / kappa;

            xyz2rgb(x_, y_, z_, R, G, B, wip);

            if (R < 0.0f || G < 0.0f || B < 0.0f) {

                if (std::isnan(HH)) {
                    float atemp = ChprovSave * sincosval.y * 327.68;
                    float btemp = ChprovSave * sincosval.x * 327.68;
                    HH = xatan2f(btemp, atemp);
                }

                if (Lprov1 < 0.1f) {
                    Lprov1 = 0.1f;
                }

                if(HH < -0.9f && HH > -1.55f ) {
                    if(Chprov1 > 160.f) if (Lprov1 < 5.f) {
                            Lprov1 = 5.f;
                        }

                    if(Chprov1 > 140.f) if (Lprov1 < 3.5f) {
                            Lprov1 = 3.5f;
                        }

                    if(Chprov1 > 120.f) if (Lprov1 < 2.f) {
                            Lprov1 = 2.f;
                        }

                    if(Chprov1 > 105.f) if (Lprov1 < 1.f) {
                            Lprov1 = 1.f;
                        }

                    if(Chprov1 > 90.f) if (Lprov1 < 0.7f) {
                            Lprov1 = 0.7f;
                        }

                    if(Chprov1 > 50.f) if (Lprov1 < 0.5f) {
                            Lprov1 = 0.5f;
                        }

                    if(Chprov1 > 20.f) if (Lprov1 < 0.4f) {
                            Lprov1 = 0.4f;
                        }
                }

                    Chprov1 *= higherCoef;


                if (Chprov1 <= 3.0f) {
                    Lprov1 += lowerCoef;
                }

                inGamut = false;
            } else if (!isHLEnabled && rtengine::max(R, G, B) > ClipLevel && rtengine::min(R, G, B) <= ClipLevel) {

                if (Lprov1 > 99.999f) {
                    Lprov1 = 99.98f;
                }

                Chprov1 *= higherCoef;

                if (Chprov1 <= 3.0f) {
                    Lprov1 -= lowerCoef;
                }

                inGamut = false;
            }
        } while (!inGamut);
    }
};

}
