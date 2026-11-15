// RawTherapee 5.13 (1924179) rtengine/curves.cc lines 41-65, verbatim. GPL-3.0-or-later.
void fillCurveArray(const rtengine::DiagonalCurve* diagCurve, LUTf &outCurve, int skip, bool needed)
{
    if (needed) {
        for (int i = 0; i <= 0xffff; i += i < 0xffff - skip ? skip : 1) {
            // change to [0,1] range
            // apply custom/parametric/NURBS curve, if any
            outCurve[i] = diagCurve->getVal(i / 65535.f);
        }

        // if skip > 1, let apply linear interpolation in the skipped points of the curve
        if (skip > 1) {
            const float skipmul = 1.f / skip;

            for (int i = 0; i <= 0x10000 - skip; i += skip) {
                for (int j = 1; j < skip; j++) {
                    outCurve[i + j] = (outCurve[i] * (skip - j) + outCurve[i + skip] * j) * skipmul;
                }
            }
        }

        outCurve *= 65535.f;
    } else {
        outCurve.makeIdentity();
    }
}
