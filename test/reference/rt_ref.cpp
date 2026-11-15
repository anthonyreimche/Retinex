// Runs RawTherapee 5.13's Retinex, compiled from its own source (rt/upstream:
// whole files and verbatim fragments of ipretinex.cc and rawimagesource.cc;
// rt/stubs: the few declarations those reach, with bodies copied from
// color.h/.cc), over the images and cases build.cjs writes, the way
// simpleprocess.cc:245-260 calls it. Prints JSON: per case the RGB result as
// base64 float32, and MSR's statistics. GPL-3.0-or-later.
//
// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
// 2015 Jacques Desmis <jdesmis@gmail.com>, 2015 Ingo Weyrich <heckflosse67@gmx.de>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "color.h"
#include "curves.h"
#include "gauss.h"
#include "jaggedarray.h"
#include "median.h"
#include "opthelper.h"
#include "procparams.h"
#include "rawimagesource.h"
#include "shmap.h"
#include "StopWatch.h"
#include "boxblur.h"

using namespace std;

namespace rtengine
{
LUTf Color::cachef;
LUTf Color::cachefy;
LUTf Color::gammatab_13_2;
LUTf Color::igammatab_13_2;
LUTf Color::gammatab_115_2;
LUTf Color::igammatab_115_2;
LUTf Color::gammatab_145_3;
LUTf Color::igammatab_145_3;

// color.cc:172-233, 369-409: the tables Retinex reads.
void Color::init()
{
    constexpr auto maxindex = 65536;
    cachef(maxindex, LUT_CLIP_BELOW);
    cachefy(maxindex, LUT_CLIP_BELOW);
    gammatab_13_2(maxindex, 0);
    igammatab_13_2(maxindex, 0);
    gammatab_115_2(maxindex, 0);
    igammatab_115_2(maxindex, 0);
    gammatab_145_3(maxindex, 0);
    igammatab_145_3(maxindex, 0);
    {
        int i = 0;
        int epsmaxint = eps_max;
        for (; i <= epsmaxint; i++) {
            cachef[i] = 327.68 * ((kappa * i / MAXVALF + 16.0) / 116.0);
        }
        for(; i < maxindex; i++) {
            cachef[i] = 327.68 * std::cbrt((double)i / MAXVALF);
        }
    }
    {
        int i = 0;
        int epsmaxint = eps_max;
        for (; i <= epsmaxint; i++) {
            cachefy[i] = 327.68 * (kappa * i / MAXVALF);
        }
        for(; i < maxindex; i++) {
            cachefy[i] = 327.68 * (116.0 * std::cbrt((double)i / MAXVALF) - 16.0);
        }
    }
    for (int i = 0; i < maxindex; i++) {
        gammatab_13_2[i] = 65535.0 * gamma13_2 (i / 65535.0);
        igammatab_13_2[i] = 65535.0 * igamma13_2 (i / 65535.0);
        gammatab_115_2[i] = 65535.0 * gamma115_2 (i / 65535.0);
        igammatab_115_2[i] = 65535.0 * igamma115_2 (i / 65535.0);
        gammatab_145_3[i] = 65535.0 * gamma145_3 (i / 65535.0);
        igammatab_145_3[i] = 65535.0 * igamma145_3 (i / 65535.0);
    }
}

static Settings theSettings;
Settings* settings = &theSettings;

static ICCStore theStore;
ICCStore* ICCStore::getInstance()
{
    return &theStore;
}
TMatrix ICCStore::workingSpaceMatrix(const std::string&) const
{
    return forward;
}
TMatrix ICCStore::workingSpaceInverseMatrix(const std::string&) const
{
    return inverse;
}
}

#include "ipretinex-msr.inc"
}

namespace rtengine
{
using namespace procparams;
#include "rawimagesource-retinex.inc"
}

namespace
{

const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

string base64(const float* data, size_t n)
{
    const unsigned char* p = reinterpret_cast<const unsigned char*>(data);
    size_t len = n * sizeof(float);
    string out;
    out.reserve((len + 2) / 3 * 4);
    for (size_t i = 0; i < len; i += 3) {
        uint32_t v = p[i] << 16;
        if (i + 1 < len) v |= p[i + 1] << 8;
        if (i + 2 < len) v |= p[i + 2];
        out += B64[(v >> 18) & 63];
        out += B64[(v >> 12) & 63];
        out += i + 1 < len ? B64[(v >> 6) & 63] : '=';
        out += i + 2 < len ? B64[v & 63] : '=';
    }
    return out;
}

vector<double> numbers(const string& s)
{
    vector<double> out;
    stringstream ss(s);
    string item;
    while (getline(ss, item, ',')) {
        if (!item.empty()) out.push_back(atof(item.c_str()));
    }
    return out;
}

struct Image {
    int w, h;
    vector<float> rgb;
};

}

// stdin: the images file and the cases file, one path a line.
// Images: int count; per image int w, int h, float rgb[w*h*3] (0..65535).
// Cases: one a line, `name|image|key=value;key=value;...`, curves as
// comma-separated numbers, matrices as `forward`/`inverse` (9 numbers each).
int main(int argc, char** argv)
{
    if (argc < 3) {
        fprintf(stderr, "usage: rt_ref images.bin cases.txt\n");
        return 2;
    }
    rtengine::Color::init();
    vector<Image> images;
    {
        ifstream in(argv[1], ios::binary);
        int32_t count = 0;
        in.read(reinterpret_cast<char*>(&count), 4);
        for (int i = 0; i < count; i++) {
            Image im;
            int32_t wh[2];
            in.read(reinterpret_cast<char*>(wh), 8);
            im.w = wh[0];
            im.h = wh[1];
            im.rgb.resize(size_t(im.w) * im.h * 3);
            in.read(reinterpret_cast<char*>(im.rgb.data()), im.rgb.size() * 4);
            images.push_back(std::move(im));
        }
    }
    ifstream cases(argv[2]);
    string line;
    printf("{\"cases\":[");
    bool first = true;
    while (getline(cases, line)) {
        if (line.empty()) continue;
        size_t a = line.find('|');
        size_t b = line.find('|', a + 1);
        string name = line.substr(0, a);
        const Image& im = images[atoi(line.substr(a + 1, b - a - 1).c_str())];
        rtengine::procparams::RetinexParams p;
        rtengine::procparams::ToneCurveParams tc;
        rtengine::procparams::ColorManagementParams icm;
        icm.workingProfile = "working";
        stringstream ss(line.substr(b + 1));
        string kv;
        while (getline(ss, kv, ';')) {
            size_t e = kv.find('=');
            if (e == string::npos) continue;
            string k = kv.substr(0, e);
            string v = kv.substr(e + 1);
            if (k == "cdcurve") p.cdcurve = numbers(v);
            else if (k == "cdHcurve") p.cdHcurve = numbers(v);
            else if (k == "lhcurve") p.lhcurve = numbers(v);
            else if (k == "transmissionCurve") p.transmissionCurve = numbers(v);
            else if (k == "gaintransmissionCurve") p.gaintransmissionCurve = numbers(v);
            else if (k == "mapcurve") p.mapcurve = numbers(v);
            else if (k == "str") p.str = atoi(v.c_str());
            else if (k == "scal") p.scal = atoi(v.c_str());
            else if (k == "iter") p.iter = atoi(v.c_str());
            else if (k == "grad") p.grad = atoi(v.c_str());
            else if (k == "grads") p.grads = atoi(v.c_str());
            else if (k == "gam") p.gam = atof(v.c_str());
            else if (k == "slope") p.slope = atof(v.c_str());
            else if (k == "neigh") p.neigh = atoi(v.c_str());
            else if (k == "offs") p.offs = atoi(v.c_str());
            else if (k == "highlights") p.highlights = atoi(v.c_str());
            else if (k == "htonalwidth") p.htonalwidth = atoi(v.c_str());
            else if (k == "shadows") p.shadows = atoi(v.c_str());
            else if (k == "stonalwidth") p.stonalwidth = atoi(v.c_str());
            else if (k == "radius") p.radius = atoi(v.c_str());
            else if (k == "retinexMethod") p.retinexMethod = v;
            else if (k == "retinexcolorspace") p.retinexcolorspace = v;
            else if (k == "gammaretinex") p.gammaretinex = v;
            else if (k == "mapMethod") p.mapMethod = v;
            else if (k == "viewMethod") p.viewMethod = v;
            else if (k == "vart") p.vart = atoi(v.c_str());
            else if (k == "limd") p.limd = atoi(v.c_str());
            else if (k == "highl") p.highl = atoi(v.c_str());
            else if (k == "skal") p.skal = atoi(v.c_str());
            else if (k == "medianmap") p.medianmap = v == "1";
            else if (k == "hrenabled") tc.hrenabled = v == "1";
            else if (k == "forward" || k == "inverse") {
                vector<double> m = numbers(v);
                double (*dst)[3] = k == "forward" ? rtengine::ICCStore::getInstance()->forward : rtengine::ICCStore::getInstance()->inverse;
                for (int i = 0; i < 9; i++) dst[i / 3][i % 3] = m[i];
            }
        }
        p.enabled = true;

        rtengine::RawImageSource src;
        src.W = im.w;
        src.H = im.h;
        src.border = 0;
        src.red(im.w, im.h);
        src.green(im.w, im.h);
        src.blue(im.w, im.h);
        for (int y = 0; y < im.h; y++) {
            for (int x = 0; x < im.w; x++) {
                size_t k = (size_t(y) * im.w + x) * 3;
                src.red[y][x] = im.rgb[k];
                src.green[y][x] = im.rgb[k + 1];
                src.blue[y][x] = im.rgb[k + 2];
            }
        }
        LUTf cdcurve(65536, 0);
        LUTf mapcurve(65536, 0);
        rtengine::RetinextransmissionCurve dehatransmissionCurve;
        rtengine::RetinexgaintransmissionCurve dehagaintransmissionCurve;
        bool dehacontlutili = false;
        bool mapcontlutili = false;
        bool useHsl = false;
        multi_array2D<float, 4> conversionBuffer(1, 1);
        LUTu dummy;
        src.retinexPrepareBuffers(icm, p, conversionBuffer, dummy);
        src.retinexPrepareCurves(p, cdcurve, mapcurve, dehatransmissionCurve, dehagaintransmissionCurve, dehacontlutili, mapcontlutili, useHsl, dummy, dummy);
        float minCD, maxCD, mini, maxi, Tmean, Tsigma, Tmin, Tmax;
        src.retinex(icm, p, tc, cdcurve, mapcurve, dehatransmissionCurve, dehagaintransmissionCurve, conversionBuffer, dehacontlutili, mapcontlutili, useHsl, minCD, maxCD, mini, maxi, Tmean, Tsigma, Tmin, Tmax, dummy);

        vector<float> out(size_t(im.w) * im.h * 3);
        for (int y = 0; y < im.h; y++) {
            for (int x = 0; x < im.w; x++) {
                size_t k = (size_t(y) * im.w + x) * 3;
                out[k] = src.red[y][x];
                out[k + 1] = src.green[y][x];
                out[k + 2] = src.blue[y][x];
            }
        }
        printf("%s{\"name\":\"%s\",\"w\":%d,\"h\":%d,\"mini\":%.9g,\"maxi\":%.9g,\"Tmean\":%.9g,\"Tsigma\":%.9g,\"Tmin\":%.9g,\"Tmax\":%.9g,\"minCD\":%.9g,\"maxCD\":%.9g,\"rgb\":\"%s\"}",
               first ? "" : ",", name.c_str(), im.w, im.h, mini, maxi, Tmean, Tsigma, Tmin, Tmax, minCD, maxCD, base64(out.data(), out.size()).c_str());
        first = false;
    }
    printf("]}\n");
    return 0;
}
