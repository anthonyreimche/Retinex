// RawTherapee 5.13 (1924179) rtengine/curves.h lines 411-582, verbatim. GPL-3.0-or-later.
class Curve
{

    class HashEntry
    {
    public:
        unsigned short smallerValue;
        unsigned short higherValue;
    };
protected:
    int N;
    int ppn;            // targeted polyline point number
    double* x;
    double* y;
    // begin of variables used in Parametric curves only
    double mc;
    double mfc;
    double msc;
    double mhc;
    // end of variables used in Parametric curves only
    std::vector<double> poly_x;     // X points of the faceted curve
    std::vector<double> poly_y;     // Y points of the faceted curve
    std::vector<double> dyByDx;
    std::vector<HashEntry> hash;
    unsigned short hashSize;        // hash table's size, between [10, 100, 1000]

    double* ypp;

    // Fields for the elementary curve polygonisation
    double x1, y1, x2, y2, x3, y3;
    bool firstPointIncluded;
    double increment;
    int nbr_points;

    static inline double p00(double x, double prot)
    {
        return CurveFactory::clower(x, 2.0, prot);
    }
    static inline double p11(double x, double prot)
    {
        return CurveFactory::cupper(x, 2.0, prot);
    }
    static inline double p01(double x, double prot)
    {
        return x <= 0.5 ? CurveFactory::clower(x * 2, 2.0, prot) * 0.5 : 0.5 + CurveFactory::cupper((x - 0.5) * 2, 2.0, prot) * 0.5;
    }
    static inline double p10(double x, double prot)
    {
        return x <= 0.5 ? CurveFactory::cupper(x * 2, 2.0, prot) * 0.5 : 0.5 + CurveFactory::clower((x - 0.5) * 2, 2.0, prot) * 0.5;
    }
    static inline double pfull(double x, double prot, double sh, double hl)
    {
        return (1 - sh) * (1 - hl) * p00(x, prot) + sh * hl * p11(x, prot) + (1 - sh) * hl * p01(x, prot) + sh * (1 - hl) * p10(x, prot);
    }
    static inline double pfull_alt(double x, double sh, double hl)
    {
        double t = (1.0 - sh) * (1.0 - hl) * CurveFactory::basel_alt(x) + sh * hl * CurveFactory::baseu_alt(x);
        return x <= 0.5
            ? t + (1.0 - sh) * hl * CurveFactory::basel_alt(2.0 * x) * 0.5 + sh * (1.0 - hl) * CurveFactory::baseu_alt(2.0 * x) * 0.5
            : t + (1.0 - sh) * hl * (0.5 + CurveFactory::baseu_alt(2.0 * x - 1.0) * 0.5) + sh * (1.0 - hl) * (0.5 + CurveFactory::basel_alt(2.0 * x - 1.0) * 0.5);
    }

    void fillHash();
    void fillDyByDx();

public:
    Curve();
    virtual ~Curve() {};
    void AddPolygons();
    int getSize() const;  // return the number of control points
    void getControlPoint(int cpNum, double &x, double &y) const;
    virtual double getVal(double t) const = 0;
    virtual void   getVal(const std::vector<double>& t, std::vector<double>& res) const = 0;

    virtual bool   isIdentity() const = 0;
};

class DiagonalCurve final : public Curve
{

protected:
    DiagonalCurveType kind;

    void spline_cubic_set();
    void catmull_rom_set();
    void NURBS_set();

public:
    explicit DiagonalCurve(const std::vector<double>& points, int ppn = CURVES_MIN_POLY_POINTS);
    ~DiagonalCurve() override;

    double getVal(double t) const override;
    void   getVal(const std::vector<double>& t, std::vector<double>& res) const override;
    bool   isIdentity() const override
    {
        return kind == DCT_Empty;
    };
};

class FlatCurve final : public Curve
{

private:
    FlatCurveType kind;
    double* leftTangent;
    double* rightTangent;
    double identityValue;
    bool periodic;

    void CtrlPoints_set();

public:

    explicit FlatCurve(const std::vector<double>& points, bool isPeriodic = true, int ppn = CURVES_MIN_POLY_POINTS);
    ~FlatCurve() override;

    double getVal(double t) const override;
    void   getVal(const std::vector<double>& t, std::vector<double>& res) const override;
    bool   setIdentityValue(double iVal);
    bool   isIdentity() const override
    {
        return kind == FCT_Empty;
    };
};

class RetinextransmissionCurve
{
private:
    LUTf luttransmission;  // 0xffff range
    void Set(const Curve &pCurve);

public:
    virtual ~RetinextransmissionCurve() {};
    RetinextransmissionCurve();

    void Reset();
    void Set(const Curve *pCurve);
    void Set(const std::vector<double> &curvePoints);
    float operator[](float index) const
    {
        return luttransmission[index];
    }

    operator bool (void) const
    {
        return luttransmission;
    }
};

class RetinexgaintransmissionCurve
{
private:
    LUTf lutgaintransmission;  // 0xffff range
    void Set(const Curve &pCurve);

public:
    virtual ~RetinexgaintransmissionCurve() {};
    RetinexgaintransmissionCurve();

    void Reset();
    void Set(const Curve *pCurve);
    void Set(const std::vector<double> &curvePoints);
    float operator[](float index) const
    {
        return lutgaintransmission[index];
    }

    operator bool (void) const
    {
        return lutgaintransmission;
    }
};
