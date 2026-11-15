// RawTherapee 5.13's Curve helpers, LUT builders and Retinex transmission
// curves (curves.cc, verbatim fragments in rt/upstream). GPL-3.0-or-later.
// Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
#include <cmath>
#include <memory>
#include <vector>
#include "curves.h"

using namespace std;

namespace {
#include "curves-fill.inc"
}
namespace rtengine
{
#include "curves-curve.inc"
#include "curves-lut.inc"
#include "curves-retinex.inc"
}
