// RawTherapee 5.13 (1924179) rtengine/rawimagesource.cc lines 1936-2586, verbatim. GPL-3.0-or-later.
//void RawImageSource::retinexPrepareBuffers(ColorManagementParams cmp, RetinexParams retinexParams, multi_array2D<float, 3> &conversionBuffer, LUTu &lhist16RETI)
void RawImageSource::retinexPrepareBuffers(const ColorManagementParams& cmp, const RetinexParams &retinexParams, multi_array2D<float, 4> &conversionBuffer, LUTu &lhist16RETI)
{
    bool useHsl = (retinexParams.retinexcolorspace == "HSLLOG" || retinexParams.retinexcolorspace == "HSLLIN");
    conversionBuffer[0](W - 2 * border, H - 2 * border);
    conversionBuffer[1](W - 2 * border, H - 2 * border);
    conversionBuffer[2](W - 2 * border, H - 2 * border);
    conversionBuffer[3](W - 2 * border, H - 2 * border);

    LUTf *retinexgamtab = nullptr;//gamma before and after Retinex to restore tones
    LUTf lutTonereti;

    if (retinexParams.gammaretinex == "low") {
        retinexgamtab = &(Color::gammatab_115_2);
    } else if (retinexParams.gammaretinex == "mid") {
        retinexgamtab = &(Color::gammatab_13_2);
    } else if (retinexParams.gammaretinex == "hig") {
        retinexgamtab = &(Color::gammatab_145_3);
    } else if (retinexParams.gammaretinex == "fre") {
        GammaValues g_a;
        double pwr = 1.0 / retinexParams.gam;
        double gamm = retinexParams.gam;
        double ts = retinexParams.slope;
        double gamm2 = retinexParams.gam;

        if (gamm2 < 1.) {
            std::swap(pwr, gamm);
        }

        Color::calcGamma(pwr, ts, g_a); // call to calcGamma with selected gamma and slope

        double start;
        double add;

        if (gamm2 < 1.) {
            start = g_a[2];
            add = g_a[4];
        } else {
            start = g_a[3];
            add = g_a[4];
        }

        double mul = 1. + g_a[4];

        lutTonereti(65536);

        for (int i = 0; i < 65536; i++) {
            double val = (i) / 65535.;
            double x;

            if (gamm2 < 1.) {
                x = Color::igammareti(val, gamm, start, ts, mul, add);
            } else {
                x = Color::gammareti(val, gamm, start, ts, mul, add);
            }

            lutTonereti[i] = CLIP(x * 65535.);// CLIP avoid in some case extra values
        }

        retinexgamtab = &lutTonereti;
    }

    /*
    //test with amsterdam.pef and other files
    float rr,gg,bb;
    rr=red[50][2300];
    gg=green[50][2300];
    bb=blue[50][2300];
    printf("rr=%f gg=%f bb=%f \n",rr,gg,bb);
    rr=red[1630][370];
    gg=green[1630][370];
    bb=blue[1630][370];
    printf("rr1=%f gg1=%f bb1=%f \n",rr,gg,bb);
    rr=red[380][1630];
    gg=green[380][1630];
    bb=blue[380][1630];
    printf("rr2=%f gg2=%f bb2=%f \n",rr,gg,bb);
    */
    /*
    if (retinexParams.highlig < 100 && retinexParams.retinexMethod == "highliplus") {//try to recover magenta...very difficult !
        float hig = ((float)retinexParams.highlig)/100.f;
        float higgb = ((float)retinexParams.grbl)/100.f;

    #ifdef _OPENMP
            #pragma omp parallel for
    #endif
            for (int i = border; i < H - border; i++) {
                for (int j = border; j < W - border; j++) {
                    float R_,G_,B_;
                    R_=red[i][j];
                    G_=green[i][j];
                    B_=blue[i][j];

                    //empirical method to find highlight magenta with no conversion RGB and no white balance
                    //red = master   Gr and Bl default higgb=0.5
         //           if (R_>65535.f*hig  && G_ > 65535.f*higgb && B_ > 65535.f*higgb) conversionBuffer[3][i - border][j - border] = R_;
          //          else conversionBuffer[3][i - border][j - border] = 0.f;
                }
            }
    }
    */
    if (retinexParams.gammaretinex != "none" && retinexParams.str != 0 && retinexgamtab) {//gamma

#ifdef _OPENMP
        #pragma omp parallel for
#endif

        for (int i = border; i < H - border; i++) {
            for (int j = border; j < W - border; j++) {
                float R_, G_, B_;
                R_ = red[i][j];
                G_ = green[i][j];
                B_ = blue[i][j];

                red[i][j] = (*retinexgamtab)[R_];
                green[i][j] = (*retinexgamtab)[G_];
                blue[i][j] = (*retinexgamtab)[B_];
            }
        }
    }

    if (useHsl) {
#ifdef _OPENMP
        #pragma omp parallel
#endif
        {
            // one LUT per thread
            LUTu lhist16RETIThr;

            if (lhist16RETI)
            {
                lhist16RETIThr(lhist16RETI.getSize());
                lhist16RETIThr.clear();
            }

#if defined(__SSE2__) || defined(RT_SIMDE)
            vfloat c32768 = F2V(32768.f);
#endif
#ifdef _OPENMP
            #pragma omp for
#endif

            for (int i = border; i < H - border; i++)
            {
                int j = border;
#if defined(__SSE2__) || defined(RT_SIMDE)

                for (; j < W - border - 3; j += 4) {
                    vfloat H, S, L;
                    Color::rgb2hsl(LVFU(red[i][j]), LVFU(green[i][j]), LVFU(blue[i][j]), H, S, L);
                    STVFU(conversionBuffer[0][i - border][j - border], H);
                    STVFU(conversionBuffer[1][i - border][j - border], S);
                    L *= c32768;
                    STVFU(conversionBuffer[2][i - border][j - border], L);
                    STVFU(conversionBuffer[3][i - border][j - border], H);

                    if (lhist16RETI) {
                        for (int p = 0; p < 4; p++) {
                            int pos = (conversionBuffer[2][i - border][j - border + p]);//histogram in curve HSL
                            lhist16RETIThr[pos]++;
                        }
                    }
                }

#endif

                for (; j < W - border; j++) {
                    float L;
                    //rgb=>lab
                    Color::rgb2hslfloat(red[i][j], green[i][j], blue[i][j], conversionBuffer[0][i - border][j - border], conversionBuffer[1][i - border][j - border], L);
                    L *= 32768.f;
                    conversionBuffer[2][i - border][j - border] = L;

                    if (lhist16RETI) {
                        int pos = L;
                        lhist16RETIThr[pos]++;
                    }
                }
            }

#ifdef _OPENMP
            #pragma omp critical
            {
                if (lhist16RETI)
                {
                    lhist16RETI += lhist16RETIThr; // Add per Thread LUT to global LUT
                }
            }
#endif

        }
    } else {
        TMatrix wprof = ICCStore::getInstance()->workingSpaceMatrix(cmp.workingProfile);
        const float wp[3][3] = {
            {static_cast<float>(wprof[0][0]), static_cast<float>(wprof[0][1]), static_cast<float>(wprof[0][2])},
            {static_cast<float>(wprof[1][0]), static_cast<float>(wprof[1][1]), static_cast<float>(wprof[1][2])},
            {static_cast<float>(wprof[2][0]), static_cast<float>(wprof[2][1]), static_cast<float>(wprof[2][2])}
        };

        // Conversion rgb -> lab is hard to vectorize because it uses a lut (that's not the main problem)
        // and it uses a condition inside XYZ2Lab which is almost impossible to vectorize without making it slower...
#ifdef _OPENMP
        #pragma omp parallel
#endif
        {
            // one LUT per thread
            LUTu lhist16RETIThr;

            if (lhist16RETI) {
                lhist16RETIThr(lhist16RETI.getSize());
                lhist16RETIThr.clear();
            }

#ifdef _OPENMP
            #pragma omp for schedule(dynamic,16)
#endif

            for (int i = border; i < H - border; i++)
                for (int j = border; j < W - border; j++) {
                    float X, Y, Z, L, aa, bb;
                    //rgb=>lab
                    Color::rgbxyz(red[i][j], green[i][j], blue[i][j], X, Y, Z, wp);
                    //convert Lab
                    Color::XYZ2Lab(X, Y, Z, L, aa, bb);
                    conversionBuffer[0][i - border][j - border] = aa;
                    conversionBuffer[1][i - border][j - border] = bb;
                    conversionBuffer[2][i - border][j - border] = L;
                    conversionBuffer[3][i - border][j - border] = xatan2f(bb, aa);

//                   if (R_>40000.f  && G_ > 30000.f && B_ > 30000.f) conversionBuffer[3][i - border][j - border] = R_;
//                   else conversionBuffer[3][i - border][j - border] = 0.f;
                    if (lhist16RETI) {
                        int pos = L;
                        lhist16RETIThr[pos]++;//histogram in Curve Lab
                    }
                }

#ifdef _OPENMP
            #pragma omp critical
            {
                if (lhist16RETI) {
                    lhist16RETI += lhist16RETIThr; // Add per Thread LUT to global LUT
                }
            }
#endif

        }
    }



}

void RawImageSource::retinexPrepareCurves(const RetinexParams &retinexParams, LUTf &cdcurve, LUTf &mapcurve, RetinextransmissionCurve &retinextransmissionCurve, RetinexgaintransmissionCurve &retinexgaintransmissionCurve, bool &retinexcontlutili, bool &mapcontlutili, bool &useHsl, LUTu & lhist16RETI, LUTu & histLRETI)
{
    useHsl = (retinexParams.retinexcolorspace == "HSLLOG" || retinexParams.retinexcolorspace == "HSLLIN");

    if (useHsl) {
        retinexcontlutili = CurveFactory::diagonalCurve2Lut(retinexParams.cdHcurve, cdcurve, 1, lhist16RETI, histLRETI);
    } else {
        retinexcontlutili = CurveFactory::diagonalCurve2Lut(retinexParams.cdcurve, cdcurve, 1, lhist16RETI, histLRETI);
    }

    mapcontlutili = CurveFactory::diagonalCurve2Lut(retinexParams.mapcurve, mapcurve, 1, lhist16RETI, histLRETI);
    mapcurve *= 0.5f;
    retinexParams.getCurves(retinextransmissionCurve, retinexgaintransmissionCurve);
}

void RawImageSource::retinex(const ColorManagementParams& cmp, const RetinexParams &deh, const ToneCurveParams& Tc, LUTf & cdcurve, LUTf & mapcurve, const RetinextransmissionCurve & dehatransmissionCurve, const RetinexgaintransmissionCurve & dehagaintransmissionCurve, multi_array2D<float, 4> &conversionBuffer, bool dehacontlutili, bool mapcontlutili, bool useHsl, float &minCD, float &maxCD, float &mini, float &maxi, float &Tmean, float &Tsigma, float &Tmin, float &Tmax, LUTu &histLRETI)
{
    MyTime t4, t5;
    t4.set();

    if (settings->verbose) {
        printf("Applying Retinex\n");
    }

    LUTf lutToneireti;
    lutToneireti(65536);

    LUTf *retinexigamtab = nullptr;//gamma before and after Retinex to restore tones

    if (deh.gammaretinex == "low") {
        retinexigamtab = &(Color::igammatab_115_2);
    } else if (deh.gammaretinex == "mid") {
        retinexigamtab = &(Color::igammatab_13_2);
    } else if (deh.gammaretinex == "hig") {
        retinexigamtab = &(Color::igammatab_145_3);
    } else if (deh.gammaretinex == "fre") {
        GammaValues g_a;
        double pwr = 1.0 / deh.gam;
        double gamm = deh.gam;
        double gamm2 = gamm;
        double ts = deh.slope;

        if (gamm2 < 1.) {
            std::swap(pwr, gamm);
        }

        Color::calcGamma(pwr, ts, g_a); // call to calcGamma with selected gamma and slope

        double mul = 1. + g_a[4];
        double add;
        double start;

        if (gamm2 < 1.) {
            start = g_a[3];
            add = g_a[3];
        } else {
            add = g_a[4];
            start = g_a[2];
        }

        //    printf("g_a0=%f g_a1=%f g_a2=%f g_a3=%f g_a4=%f\n", g_a0,g_a1,g_a2,g_a3,g_a4);
        for (int i = 0; i < 65536; i++) {
            double val = (i) / 65535.;
            double x;

            if (gamm2 < 1.) {
                x = Color::gammareti(val, gamm, start, ts, mul, add);
            } else {
                x = Color::igammareti(val, gamm, start, ts, mul, add);
            }

            lutToneireti[i] = CLIP(x * 65535.);
        }

        retinexigamtab = &lutToneireti;
    }

    // We need a buffer with original L data to allow correct blending
    // red, green and blue still have original size of raw, but we can't use the borders
    const int HNew = H - 2 * border;
    const int WNew = W - 2 * border;

    array2D<float> LBuffer(WNew, HNew);
    float **temp = conversionBuffer[2]; // one less dereference
    LUTf dLcurve;
    LUTu hist16RET;

    if (dehacontlutili && histLRETI) {
        hist16RET(32768);
        hist16RET.clear();
        histLRETI.clear();
        dLcurve(32768);
    }

    FlatCurve* chcurve = nullptr;//curve c=f(H)
    bool chutili = false;

    if (deh.enabled && deh.retinexMethod == "highli") {
        chcurve = new FlatCurve(deh.lhcurve);

        if (!chcurve || chcurve->isIdentity()) {
            if (chcurve) {
                delete chcurve;
                chcurve = nullptr;
            }
        } else {
            chutili = true;
        }
    }



#ifdef _OPENMP
    #pragma omp parallel
#endif
    {
        // one LUT per thread
        LUTu hist16RETThr;

        if (hist16RET) {
            hist16RETThr(hist16RET.getSize());
            hist16RETThr.clear();
        }

#ifdef _OPENMP
        #pragma omp for
#endif

        for (int i = 0; i < H - 2 * border; i++)
            if (dehacontlutili)
                for (int j = 0; j < W - 2 * border; j++) {
                    LBuffer[i][j] = cdcurve[2.f * temp[i][j]] / 2.f;

                    if (histLRETI) {
                        int pos = LBuffer[i][j];
                        hist16RETThr[pos]++; //histogram in Curve
                    }
                } else
                for (int j = 0; j < W - 2 * border; j++) {
                    LBuffer[i][j] = temp[i][j];
                }

#ifdef _OPENMP
        #pragma omp critical
#endif
        {
            if (hist16RET) {
                hist16RET += hist16RETThr; // Add per Thread LUT to global LUT
            }
        }
    }

    if (hist16RET) {//update histogram
        // TODO : When rgbcurvesspeedup branch is merged into master, replace this by the following 1-liner
        // hist16RET.compressTo(histLRETI);
        // also remove declaration and init of dLcurve some lines above then and finally remove this comment :)
        for (int i = 0; i < 32768; i++) {
            float val = (double)i / 32767.0;
            dLcurve[i] = val;
        }

        for (int i = 0; i < 32768; i++) {
            float hval = dLcurve[i];
            int hi = (int)(255.0f * hval);
            histLRETI[hi] += hist16RET[i];
        }
    }

    MSR(LBuffer, conversionBuffer[2], conversionBuffer[3], mapcurve, mapcontlutili, WNew, HNew, deh, dehatransmissionCurve, dehagaintransmissionCurve, minCD, maxCD, mini, maxi, Tmean, Tsigma, Tmin, Tmax);

    if (useHsl) {
        if (chutili) {
#ifdef _OPENMP
            #pragma omp parallel for
#endif

            for (int i = border; i < H - border; i++) {
                int j = border;

                for (; j < W - border; j++) {

                    float valp = (chcurve->getVal(conversionBuffer[3][i - border][j - border]) - 0.5f);
                    conversionBuffer[1][i - border][j - border] *= (1.f + 2.f * valp);

                }
            }
        }

#ifdef _OPENMP
        #pragma omp parallel for
#endif

        for (int i = border; i < H - border; i++) {
            int j = border;
#if defined(__SSE2__) || defined(RT_SIMDE)
            vfloat c32768 = F2V(32768.f);

            for (; j < W - border - 3; j += 4) {
                vfloat R, G, B;
                Color::hsl2rgb(LVFU(conversionBuffer[0][i - border][j - border]), LVFU(conversionBuffer[1][i - border][j - border]), LVFU(LBuffer[i - border][j - border]) / c32768, R, G, B);

                STVFU(red[i][j], R);
                STVFU(green[i][j], G);
                STVFU(blue[i][j], B);
            }

#endif

            for (; j < W - border; j++) {
                Color::hsl2rgbfloat(conversionBuffer[0][i - border][j - border], conversionBuffer[1][i - border][j - border], LBuffer[i - border][j - border] / 32768.f, red[i][j], green[i][j], blue[i][j]);
            }
        }

    } else {
        TMatrix wiprof = ICCStore::getInstance()->workingSpaceInverseMatrix(cmp.workingProfile);

        double wip[3][3] = {
            {wiprof[0][0], wiprof[0][1], wiprof[0][2]},
            {wiprof[1][0], wiprof[1][1], wiprof[1][2]},
            {wiprof[2][0], wiprof[2][1], wiprof[2][2]}
        };
        // gamut control only in Lab mode
        const bool highlight = Tc.hrenabled;
#ifdef _OPENMP
        #pragma omp parallel
#endif
        {
#if defined(__SSE2__) || defined(RT_SIMDE)
            // we need some line buffers to precalculate some expensive stuff using SSE
            float atan2Buffer[W] ALIGNED16;
            float sqrtBuffer[W] ALIGNED16;
            float sincosxBuffer[W] ALIGNED16;
            float sincosyBuffer[W] ALIGNED16;
            const vfloat c327d68v = F2V(327.68);
            const vfloat onev = F2V(1.f);
#endif // __SSE2__
#ifdef _OPENMP
            #pragma omp for
#endif

            for (int i = border; i < H - border; i++) {
#if defined(__SSE2__) || defined(RT_SIMDE)
                // vectorized precalculation
                {
                    int j = border;

                    for (; j < W - border - 3; j += 4)
                    {
                        vfloat av = LVFU(conversionBuffer[0][i - border][j - border]);
                        vfloat bv = LVFU(conversionBuffer[1][i - border][j - border]);
                        vfloat chprovv = vsqrtf(SQRV(av) + SQRV(bv));
                        STVF(sqrtBuffer[j - border], chprovv / c327d68v);
                        vfloat HHv = xatan2f(bv, av);
                        STVF(atan2Buffer[j - border], HHv);
                        av /= chprovv;
                        bv /= chprovv;
                        vmask selMask = vmaskf_eq(chprovv, ZEROV);
                        STVF(sincosyBuffer[j - border], vself(selMask, onev, av));
                        STVF(sincosxBuffer[j - border], vselfnotzero(selMask, bv));
                    }

                    for (; j < W - border; j++)
                    {
                        float aa = conversionBuffer[0][i - border][j - border];
                        float bb = conversionBuffer[1][i - border][j - border];
                        float Chprov1 = std::sqrt(SQR(aa) + SQR(bb)) / 327.68f;
                        sqrtBuffer[j - border] = Chprov1;
                        float HH = xatan2f(bb, aa);
                        atan2Buffer[j - border] = HH;

                        if (Chprov1 == 0.0f) {
                            sincosyBuffer[j - border] = 1.f;
                            sincosxBuffer[j - border] = 0.0f;
                        } else {
                            sincosyBuffer[j - border] = aa / (Chprov1 * 327.68f);
                            sincosxBuffer[j - border] = bb / (Chprov1 * 327.68f);
                        }
                    }
                }
#endif // __SSE2__

                for (int j = border; j < W - border; j++) {
                    float Lprov1 = (LBuffer[i - border][j - border]) / 327.68f;
#if defined(__SSE2__) || defined(RT_SIMDE)
                    float Chprov1 = sqrtBuffer[j - border];
                    float  HH = atan2Buffer[j - border];
                    float2 sincosval;
                    sincosval.x = sincosxBuffer[j - border];
                    sincosval.y = sincosyBuffer[j - border];

#else
                    float aa = conversionBuffer[0][i - border][j - border];
                    float bb = conversionBuffer[1][i - border][j - border];
                    float Chprov1 = std::sqrt(SQR(aa) + SQR(bb)) / 327.68f;
                    float  HH = xatan2f(bb, aa);
                    float2 sincosval;// = xsincosf(HH);

                    if (Chprov1 == 0.0f) {
                        sincosval.y = 1.f;
                        sincosval.x = 0.0f;
                    } else {
                        sincosval.y = aa / (Chprov1 * 327.68f);
                        sincosval.x = bb / (Chprov1 * 327.68f);
                    }

#endif

                    if (chutili) {  // c=f(H)
                        float valp = float((chcurve->getVal(Color::huelab_to_huehsv2(HH)) - 0.5f));
                        Chprov1 *= (1.f + 2.f * valp);
                    }

                    float R, G, B;
                    //gamut control : Lab values are in gamut
                    Color::gamutLchonly(HH, sincosval, Lprov1, Chprov1, R, G, B, wip, highlight, 0.15f, 0.96f);



                    conversionBuffer[0][i - border][j - border] = 327.68f * Chprov1 * sincosval.y;
                    conversionBuffer[1][i - border][j - border] = 327.68f * Chprov1 * sincosval.x;
                    LBuffer[i - border][j - border] = Lprov1 * 327.68f;
                }
            }
        }
        //end gamut control
#if defined(__SSE2__) || defined(RT_SIMDE)
        vfloat wipv[3][3];

        for (int i = 0; i < 3; i++)
            for (int j = 0; j < 3; j++) {
                wipv[i][j] = F2V(wiprof[i][j]);
            }

#endif // __SSE2__
#ifdef _OPENMP
        #pragma omp parallel for
#endif

        for (int i = border; i < H - border; i++) {
            int j = border;
#if defined(__SSE2__) || defined(RT_SIMDE)

            for (; j < W - border - 3; j += 4) {
                vfloat x_, y_, z_;
                vfloat R, G, B;
                Color::Lab2XYZ(LVFU(LBuffer[i - border][j - border]), LVFU(conversionBuffer[0][i - border][j - border]), LVFU(conversionBuffer[1][i - border][j - border]), x_, y_, z_) ;
                Color::xyz2rgb(x_, y_, z_, R, G, B, wipv);

                STVFU(red[i][j], R);
                STVFU(green[i][j], G);
                STVFU(blue[i][j], B);

            }

#endif

            for (; j < W - border; j++) {
                float x_, y_, z_;
                float R, G, B;
                Color::Lab2XYZ(LBuffer[i - border][j - border], conversionBuffer[0][i - border][j - border], conversionBuffer[1][i - border][j - border], x_, y_, z_) ;
                Color::xyz2rgb(x_, y_, z_, R, G, B, wip);
                red[i][j] = R;
                green[i][j] = G;
                blue[i][j] = B;
            }
        }
    }

    if (chcurve) {
        delete chcurve;
    }

    if (deh.gammaretinex != "none"  && deh.str != 0) { //inverse gamma
#ifdef _OPENMP
        #pragma omp parallel for
#endif

        for (int i = border; i < H - border; i++) {
            for (int j = border; j < W - border; j++) {
                float R_, G_, B_;
                R_ = red[i][j];
                G_ = green[i][j];
                B_ = blue[i][j];
                red[i][j] = (*retinexigamtab)[R_];
                green[i][j] = (*retinexigamtab)[G_];
                blue[i][j] = (*retinexigamtab)[B_];
            }
        }
    }

    rgbSourceModified = false; // tricky handling for Color propagation
    t5.set();

    if (settings->verbose) {
        printf("Retinex=%d usec\n",  t5.etime(t4));
    }

}
