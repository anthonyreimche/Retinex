// RawTherapee 5.13 (1924179) rtengine/curves.cc lines 368-411, verbatim. GPL-3.0-or-later.
bool CurveFactory::diagonalCurve2Lut(const std::vector<double>& curvePoints, LUTf & curve, int skip, const LUTu & histogram, LUTu & outBeforeCurveHistogram)
{
    bool needed = false;
    std::unique_ptr<DiagonalCurve> dCurve;
    outBeforeCurveHistogram.clear();
    bool histNeeded = false;

    if (!curvePoints.empty() && curvePoints[0] != 0) {
        dCurve.reset(new DiagonalCurve(curvePoints, CURVES_MIN_POLY_POINTS / skip));

        if (outBeforeCurveHistogram) {
            histNeeded = true;
        }

        if (dCurve && !dCurve->isIdentity()) {
            needed = true;
        }
    }

    if (histNeeded) {
        histogram.compressTo(outBeforeCurveHistogram, 32768);
    }

    fillCurveArray(dCurve.get(), curve, skip, needed);
    return needed;
}

bool CurveFactory::diagonalCurve2Lut(const std::vector<double>& curvePoints, LUTf& curve, int skip)
{
    bool needed = false;
    std::unique_ptr<DiagonalCurve> dCurve;

    if (!curvePoints.empty() && curvePoints[0] != 0) {
        dCurve.reset(new DiagonalCurve(curvePoints, CURVES_MIN_POLY_POINTS / skip));

        if (dCurve && !dCurve->isIdentity()) {
            needed = true;
        }
    }

    fillCurveArray(dCurve.get(), curve, skip, needed);
    return needed;

}
