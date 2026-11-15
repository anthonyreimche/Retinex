// RawTherapee 5.13 (1924179) rtengine/curves.cc lines 2538-2602, verbatim. GPL-3.0-or-later.
//
RetinextransmissionCurve::RetinextransmissionCurve() {}

void RetinextransmissionCurve::Reset()
{
    luttransmission.reset();
}

void RetinextransmissionCurve::Set(const Curve &pCurve)
{
    if (pCurve.isIdentity()) {
        luttransmission.reset(); // raise this value if the quality suffers from this number of samples
        return;
    }

    luttransmission(501);  // raise this value if the quality suffers from this number of samples

    for (int i = 0; i < 501; i++) {
        luttransmission[i] = pCurve.getVal(double (i) / 500.);
    }
}

void RetinextransmissionCurve::Set(const std::vector<double> &curvePoints)
{
    if (!curvePoints.empty() && curvePoints[0] > FCT_Linear && curvePoints[0] < FCT_Unchanged) {
        FlatCurve tcurve(curvePoints, false, CURVES_MIN_POLY_POINTS / 2);
        tcurve.setIdentityValue(0.);
        Set(tcurve);
    } else {
        Reset();
    }
}


RetinexgaintransmissionCurve::RetinexgaintransmissionCurve() {}

void RetinexgaintransmissionCurve::Reset()
{
    lutgaintransmission.reset();
}

void RetinexgaintransmissionCurve::Set(const Curve &pCurve)
{
    if (pCurve.isIdentity()) {
        lutgaintransmission.reset(); // raise this value if the quality suffers from this number of samples
        return;
    }

    lutgaintransmission(501);  // raise this value if the quality suffers from this number of samples

    for (int i = 0; i < 501; i++) {
        lutgaintransmission[i] = pCurve.getVal(double (i) / 500.);
    }
}

void RetinexgaintransmissionCurve::Set(const std::vector<double> &curvePoints)
{
    if (!curvePoints.empty() && curvePoints[0] > FCT_Linear && curvePoints[0] < FCT_Unchanged) {
        FlatCurve tcurve(curvePoints, false, CURVES_MIN_POLY_POINTS / 2);
        tcurve.setIdentityValue(0.);
        Set(tcurve);
    } else {
        Reset();
    }
}
