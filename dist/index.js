//#region src/curves.ts
var e = {
	linear: 0,
	spline: 1,
	parametric: 2,
	nurbs: 3,
	catmullRom: 4
}, t = {
	linear: 0,
	controlPoints: 1
}, n = 1e3, r = (e) => Math.min(Math.max(e, 0), 1), i = (e) => (2 - e) * e * e * e, a = (e) => e * (2 + (e - 2) * e * e);
function o(e, t, n) {
	let r = (1 - t) * (1 - n) * i(e) + t * n * a(e);
	return e <= .5 ? r + (1 - t) * n * i(2 * e) * .5 + t * (1 - n) * a(2 * e) * .5 : r + (1 - t) * n * (.5 + a(2 * e - 1) * .5) + t * (1 - n) * (.5 + i(2 * e - 1) * .5);
}
var s = class {
	x = [];
	y = [];
	slope = [];
	addBezier(e, t, n, r, i, a, o, s) {
		t && (this.x.push(n), this.y.push(r));
		let c = 1 / (e - 1);
		for (let t = 1; t < e - 1; t++) {
			let e = t * c, l = e * e, u = 1 - e, d = u * u, f = u * 2 * e;
			this.x.push(d * n + f * i + l * o), this.y.push(d * r + f * a + l * s);
		}
		this.x.push(o), this.y.push(s);
	}
	finish() {
		this.slope = [];
		for (let e = 0; e < this.x.length - 1; e++) this.slope.push((this.y[e + 1] - this.y[e]) / (this.x[e + 1] - this.x[e]));
	}
	segment(e) {
		let t = 0, n = this.x.length - 1;
		for (; n > 1 + t;) {
			let r = n + t >>> 1;
			this.x[r] > e ? n = r : t = r;
		}
		return t;
	}
	value(e) {
		let t = this.segment(e);
		return this.y[t] + (e - this.x[t]) * this.slope[t];
	}
}, c = class {
	kind;
	cx = [];
	cy = [];
	ypp = [];
	poly = new s();
	catmull = {
		x: [],
		y: []
	};
	px = [];
	mc = 0;
	mfc = 0;
	msc = 0;
	mhc = 0;
	constructor(t, r = n) {
		let i = Math.min(r, 65500), a = t.length < 3 ? -1 : t[0], s = !0;
		if (a === e.linear || a === e.spline || a === e.nurbs || a === e.catmullRom) {
			let n = Math.floor((t.length - 1) / 2);
			for (let e = 0; e < n; e++) this.cx.push(t[1 + 2 * e]), this.cy.push(t[2 + 2 * e]), Math.abs(this.cx[e] - this.cy[e]) >= 9e-6 && (s = !1);
			(this.cx[0] !== 0 || this.cx[n - 1] !== 1) && (s = !1), this.cx[0] === 0 && this.cx[1] === 0 && (this.cx[1] = .01), this.cx[0] === 1 && this.cx[1] === 1 && (this.cx[0] = .99), s || (a === e.spline && n > 2 ? this.splineSet() : a === e.nurbs && n > 2 ? this.nurbsSet(i) : a === e.catmullRom && n > 2 ? this.catmullRomSet(i) : a = e.linear);
		} else if (a === e.parametric && (t.length === 8 || t.length === 9) && (t[4] !== 0 || t[5] !== 0 || t[6] !== 0 || t[7] !== 0)) {
			s = !1;
			let e = [t[0]];
			for (let n = 1; n < 4; n++) e[n] = Math.min(Math.max(t[n], .001), .99);
			for (let n = 4; n < 8; n++) e[n] = (t[n] + 100) / 200;
			e[8] = t.length < 9 ? 1 : t[8] / 100, this.px = e, this.mc = -Math.log(2) / Math.log(e[2]);
			let n = o(.5, e[6], e[5]);
			this.mfc = Math.exp(Math.log(n) / this.mc), this.msc = -Math.log(2) / Math.log(e[1] / e[2]), this.mhc = -Math.log(2) / Math.log((e[3] - e[2]) / (1 - e[2]));
		}
		this.kind = s ? -1 : a;
	}
	isIdentity() {
		return this.kind === -1;
	}
	splineSet() {
		let e = this.cx, t = this.cy, n = e.length, r = Array(n - 1).fill(0), i = Array(n).fill(0);
		for (let a = 1; a < n - 1; ++a) {
			let n = (e[a] - e[a - 1]) / (e[a + 1] - e[a - 1]), o = n * i[a - 1] + 2;
			i[a] = (n - 1) / o, r[a] = (t[a + 1] - t[a]) / (e[a + 1] - e[a]) - (t[a] - t[a - 1]) / (e[a] - e[a - 1]), r[a] = (6 * r[a] / (e[a + 1] - e[a - 1]) - n * r[a - 1]) / o;
		}
		i[n - 1] = 0;
		for (let e = n - 2; e >= 0; --e) i[e] = i[e] * i[e + 1] + r[e];
		this.ypp = i;
	}
	nurbsSet(e) {
		let t = this.cx, n = this.cy, r = t.length, i = [], a = [], o = [], c = 0;
		for (let e = 0; e < r - 1;) {
			e ? (i.push((t[e - 1] + t[e]) / 2), a.push((n[e - 1] + n[e]) / 2)) : (i.push(t[e]), a.push(n[e++])), i.push(t[e]), a.push(n[e++]);
			let s = i.length - 1, l = Math.hypot(i[s] - i[s - 1], a[s] - a[s - 1]);
			e === r - 1 ? (i.push(t[e]), a.push(n[e])) : (i.push((t[e - 1] + t[e]) / 2), a.push((n[e - 1] + n[e]) / 2)), s = i.length - 1, l += Math.hypot(i[s] - i[s - 1], a[s] - a[s - 1]), o.push(l), c += l;
		}
		let l = new s();
		t[0] > 0 && (l.x.push(0), l.y.push(n[0]));
		let u = i.length - 1;
		for (let t = 0; t < u; t += 3) {
			let n = Math.trunc((e + r - 2) * o[t / 3] / c);
			l.addBezier(n, !t, i[t], a[t], i[t + 1], a[t + 1], i[t + 2], a[t + 2]);
		}
		l.x.push(3), l.y.push(n[r - 1]), l.finish(), this.poly = l;
	}
	catmullRomSet(e) {
		let t = this.cx, n = this.cy, r = Math.max(e * 65, 65e3), i = t.length, a = (e, t, n, r) => {
			let i = e - n, a = t - r, o = n - i * .01;
			return [o, i > 1e-5 ? a / i * (o - n) + r : r];
		}, [o, s] = a(t[1], n[1], t[0], n[0]), [c, l] = a(t[i - 2], n[i - 2], t[i - 1], n[i - 1]), u = [], d = [], f = (e, t, n, r, i) => Math.sqrt((r - t) ** 2 + (i - n) ** 2) ** .375 + e, p = i - 1;
		for (let e = 0; e < p; ++e) {
			let i = Math.max(Math.trunc(r * (t[e + 1] - t[e]) + .5), 2), a = e === 0 ? o : t[e - 1], m = e === 0 ? s : n[e - 1], h = t[e], g = n[e], _ = t[e + 1], v = n[e + 1], y = e === p - 1 ? c : t[e + 2], b = e === p - 1 ? l : n[e + 2], x = f(0, a, m, h, g), S = f(x, h, g, _, v), C = f(S, _, v, y, b), w = (S - x) / i;
			if (u.push(h), d.push(g), g === v && (g === 0 || g === 1)) for (let e = 1; e < i - 1; ++e) {
				let t = h + w * e;
				if (t >= _) break;
				u.push(t), d.push(g);
			}
			else for (let e = 1; e < i - 1; ++e) {
				let t = x + w * e, n = (x - t) / (x - 0), r = (t - 0) / (x - 0), i = n * a + r * h, o = n * m + r * g;
				n = (S - t) / (S - x), r = (t - x) / (S - x);
				let s = n * h + r * _, c = n * g + r * v;
				n = (C - t) / (C - S), r = (t - S) / (C - S);
				let l = n * _ + r * y, f = n * v + r * b;
				n = (S - t) / (S - 0), r = (t - 0) / (S - 0);
				let p = n * i + r * s, T = n * o + r * c;
				n = (C - t) / (C - x), r = (t - x) / (C - x);
				let E = n * s + r * l, D = n * c + r * f;
				n = (S - t) / (S - x), r = (t - x) / (S - x), u.push(n * p + r * E), d.push(n * T + r * D);
			}
			u.push(_), d.push(v);
		}
		this.catmull = {
			x: u,
			y: d
		};
	}
	getVal(t) {
		switch (this.kind) {
			case e.parametric: {
				let e = this.px;
				if (t <= 1e-14) return 0;
				let n = o(Math.exp(Math.max(this.mc * Math.log(t), -236)), e[6], e[5]), r = Math.exp(Math.log(n) / this.mc);
				if (t < e[2]) {
					let t = o(Math.exp(Math.max(this.msc * Math.log(r / this.mfc), -236)), e[7], .5);
					return this.mfc * Math.exp(Math.log(t) / this.msc);
				}
				let i = Math.exp(Math.max(this.mhc * Math.log((r - this.mfc) / (1 - this.mfc)), -236));
				if (i < 1e-6) return r;
				let a = o(i, .5, e[4]);
				return this.mfc + (1 - this.mfc) * Math.exp(Math.log(a) / this.mhc);
			}
			case e.linear:
			case e.spline: {
				let n = this.cx, i = this.cy, a = n.length;
				if (t > n[a - 1]) return i[a - 1];
				if (t < n[0]) return i[0];
				let o = 0, s = a - 1;
				for (; s > 1 + o;) {
					let e = s + o >>> 1;
					n[e] > t ? s = e : o = e;
				}
				let c = n[s] - n[o];
				if (this.kind === e.linear) return i[o] + (t - n[o]) * (i[s] - i[o]) / c;
				let l = (n[s] - t) / c, u = (t - n[o]) / c;
				return r(l * i[o] + u * i[s] + ((l * l * l - l) * this.ypp[o] + (u * u * u - u) * this.ypp[s]) * (c * c) * .16666666666666666);
			}
			case e.catmullRom: {
				let { x: e, y: n } = this.catmull, i = 0, a = e.length;
				for (; i < a;) {
					let n = i + a >>> 1;
					e[n] < t ? i = n + 1 : a = n;
				}
				if (i === e.length) return n[n.length - 1];
				let o = i;
				return o + 1 < e.length && t - e[o] > e[o + 1] - t && ++o, r(n[o]);
			}
			case e.nurbs: return this.poly.value(t);
			default: return t;
		}
	}
}, l = class {
	periodic;
	kind;
	identityValue = .5;
	cx = [];
	cy = [];
	lt = [];
	rt = [];
	n = 0;
	ppn;
	poly = new s();
	constructor(e, r = !0, i = n) {
		if (this.periodic = r, this.ppn = Math.min(i, 65500), this.kind = -1, e.length > 4) {
			let n = !0, i = e[0];
			if (this.kind = i, i === t.controlPoints) {
				let t = Math.floor((e.length - 1) / 4);
				this.n = t;
				for (let r = 0; r < t; r++) this.cx.push(e[1 + 4 * r]), this.cy.push(e[2 + 4 * r]), this.lt.push(e[3 + 4 * r]), this.rt.push(e[4 + 4 * r]), (this.cy[r] >= this.identityValue + 1e-7 || this.cy[r] <= this.identityValue - 1e-7) && (n = !1);
				r && (this.cx.push(e[1] + 1), this.cy.push(e[2]), this.lt.push(e[3]), this.rt.push(e[4])), !n && t > +!!r && this.ctrlPointsSet();
			}
			n && (this.kind = -1);
		}
	}
	setIdentityValue(e) {
		if (this.identityValue === e) return this.kind === -1;
		this.identityValue = e;
		let n = !0;
		for (let t = 0; t < this.n + +!!this.periodic; t++) if (this.cy[t] >= e + 1e-7 || this.cy[t] <= e - 1e-7) {
			n = !1;
			break;
		}
		return !n && this.n > +!!this.periodic ? (this.ctrlPointsSet(), this.kind = t.controlPoints) : (this.poly = new s(), this.kind = -1), this.kind === -1;
	}
	isIdentity() {
		return this.kind === -1;
	}
	ctrlPointsSet() {
		let e = this.cx, t = this.cy, n = this.lt, r = this.rt, i = this.periodic ? this.n : this.n - 1, a = [], o = [], c = [], l = [], u = 0, d = (e, t) => {
			a.push(e), o.push(t);
		}, f = () => {
			let e = a.length - 1;
			return Math.hypot(a[e] - a[e - 1], o[e] - o[e - 1]);
		};
		for (let a = 0; a < i;) {
			let i = r[a] === 0 || t[a] === t[a + 1], o = n[a + 1] === 0 || t[a] === t[a + 1];
			if (i && o) {
				d(e[a], t[a]), d(e[a + 1], t[a + 1]), l.push(!0), a++;
				let n = f();
				c.push(n), u += n;
			} else {
				let s = i ? e[a] : (e[a + 1] - e[a]) * r[a] + e[a], p = o ? e[a + 1] : (e[a] - e[a + 1]) * n[a + 1] + e[a + 1], m = (s + p) / 2, h = (t[a] + t[a + 1]) / 2;
				if (r[a] + n[a + 1] > 1 && (s = p = m), i) {
					d(e[a], t[a]), d(m, h), l.push(!0);
					let n = f();
					c.push(n), u += n;
				} else {
					d(e[a], t[a]), d(s, t[a]);
					let n = f();
					d(m, h), n += f(), l.push(!1), c.push(n), u += n;
				}
				if (o) {
					d(m, h), d(e[a + 1], t[a + 1]), l.push(!0);
					let n = f();
					c.push(n), u += n;
				} else {
					d(m, h), d(p, t[a + 1]);
					let n = f();
					d(e[a + 1], t[a + 1]), n += f(), l.push(!1), c.push(n), u += n;
				}
				a++;
			}
		}
		let p = new s(), m = 0;
		!this.periodic && a[0] !== 0 && (p.x.push(0), p.y.push(o[0])), p.x.push(a[0]), p.y.push(o[0]);
		for (let e = 0; e < l.length; e++) if (l[e]) m++, p.x.push(a[m]), p.y.push(o[m++]);
		else {
			let t = Math.trunc(this.ppn * c[e] / u), n = a[m], r = o[m++], i = a[m], s = o[m++], l = a[m], d = o[m++];
			p.addBezier(t, !1, n, r, i, s, l, d);
		}
		p.x.push(3), p.y.push(o[m - 1]), p.finish(), this.poly = p;
	}
	getVal(e) {
		if (this.kind !== t.controlPoints) return this.identityValue;
		let n = e;
		return n < this.poly.x[0] && (n += 1), this.poly.value(n);
	}
};
function u(e) {
	if (e.length === 0 || e[0] === 0) return null;
	let t = new c(e, n);
	if (t.isIdentity()) return null;
	let r = /* @__PURE__ */ new Float32Array(65536);
	for (let e = 0; e <= 65535; e++) r[e] = Math.fround(Math.fround(t.getVal(Math.fround(e / 65535))) * 65535);
	return r;
}
function d(e) {
	if (e.length === 0 || !(e[0] > t.linear && e[0] < 2)) return null;
	let r = new l(e, !1, n / 2);
	if (r.setIdentityValue(0)) return null;
	let i = /* @__PURE__ */ new Float32Array(501);
	for (let e = 0; e < 501; e++) i[e] = r.getVal(e / 500);
	return i;
}
function f(e) {
	let t = new l(e);
	return t.isIdentity() ? null : t;
}
//#endregion
//#region src/curve-edit.ts
function p(n, r) {
	let i = n[0] ?? 0;
	if (r) {
		if (i !== t.controlPoints) return [];
		let e = [];
		for (let t = 1; t + 3 < n.length; t += 4) e.push({
			x: n[t],
			y: n[t + 1],
			left: n[t + 2],
			right: n[t + 3]
		});
		return e;
	}
	if (i === e.linear || i === e.parametric) return [];
	let a = [];
	for (let e = 1; e + 1 < n.length; e += 2) a.push({
		x: n[e],
		y: n[e + 1],
		left: 0,
		right: 0
	});
	return a;
}
function m(e, t, n) {
	return [e, ...[...t].sort((e, t) => e.x - t.x).flatMap((e) => n ? [
		e.x,
		e.y,
		e.left,
		e.right
	] : [e.x, e.y])];
}
function h(n, r, i) {
	return r ? n === t.controlPoints ? [
		t.controlPoints,
		0,
		i,
		.35,
		.35,
		.5,
		i,
		.35,
		.35,
		1,
		i,
		.35,
		.35
	] : [t.linear] : n === e.linear ? [e.linear] : n === e.parametric ? [
		e.parametric,
		.25,
		.5,
		.75,
		0,
		0,
		0,
		0
	] : [
		n,
		0,
		0,
		.5,
		.5,
		1,
		1
	];
}
var g = {
	flat: 24,
	diagonal: 33
}, _ = .001, v = .01, y = (e) => Math.min(Math.max(e, 0), 1);
function b(e, t, n, r, i) {
	let a = p(e, t);
	if (!a[n]) return [...e];
	let o = n > 0 ? a[n - 1].x + _ : 0, s = n < a.length - 1 ? a[n + 1].x - _ : 1;
	return a[n] = {
		...a[n],
		x: Math.min(Math.max(r, o), s),
		y: y(i)
	}, m(e[0], a, t);
}
function x(e, t, n, r) {
	let i = p(e, t), a = y(n);
	if (i.length >= (t ? g.flat : g.diagonal) || i.some((e) => Math.abs(e.x - a) < .001)) return {
		curve: [...e],
		index: -1
	};
	let o = {
		x: a,
		y: y(r),
		left: .35,
		right: .35
	}, s = m(e[0], [...i, o], t);
	return {
		curve: s,
		index: p(s, t).findIndex((e) => e.x === o.x)
	};
}
function S(e, t, n) {
	let r = p(e, t);
	return r.length <= (t ? 1 : 2) ? [...e] : m(e[0], r.filter((e, t) => t !== n), t);
}
function C(e, t, n, r) {
	let i = p(e, !0);
	return i[t] ? (i[t] = {
		...i[t],
		left: y(n),
		right: y(r)
	}, m(e[0], i, !0)) : [...e];
}
function w(e, t, n, r) {
	if (t) {
		let t = new l(e, n, n ? 1e3 : 500);
		return t.setIdentityValue(r), (e) => t.getVal(e);
	}
	let i = new c(e);
	return (e) => i.getVal(e);
}
//#endregion
//#region src/rt.ts
var T, E;
function D(e) {
	E = e, T = e.react;
}
//#endregion
//#region src/Graph.tsx
var ee = 252, te = 168, O = 8, ne = 8, re = 256, ie = 8, ae = 236, oe = (e, t) => t !== null && e.length === t.length && e.every((e, n) => e === t[n]);
function se(e) {
	return `hsl(${Math.round(e * 360)}, 55%, 50%)`;
}
function k(e) {
	let { curve: t, flat: n, periodic: r, identity: i, hueBar: a } = e, o = te + (a ? 12 : 0), s = T.useRef(null), [c, l] = T.useState(-1), [u, d] = T.useState(-1), f = T.useRef(null), m = T.useRef(null), h = T.useRef(t), g = p(t, n), _ = w(t, n, r, i);
	T.useEffect(() => {
		oe(t, h.current) || (h.current = t, !oe(t, m.current) && (f.current = null, d(-1), l(-1)));
	});
	let y = (t) => {
		m.current = t, e.onChange(t);
	}, D = (e, t) => [O + e * ae, O + (1 - t) * 152], k = (e) => {
		let t = e.currentTarget.getBoundingClientRect();
		if (!(t.width > 0 && t.height > 0)) return null;
		let n = ee / t.width, r = o / t.height;
		return [((e.clientX - t.left) * n - O) / ae, 1 - ((e.clientY - t.top) * r - O) / 152];
	}, A = (e, t) => {
		let n = -1, r = ie;
		return g.forEach((i, a) => {
			let [o, s] = D(i.x, i.y), [c, l] = D(e, t), u = Math.hypot(o - c, s - l);
			u < r && (r = u, n = a);
		}), n;
	};
	T.useEffect(() => {
		let e = s.current?.getContext("2d");
		if (!e) return;
		e.clearRect(0, 0, ee, o), e.fillStyle = "rgba(0, 0, 0, 0.25)", e.fillRect(O, O, ae, 152), e.lineWidth = .5, e.strokeStyle = "rgba(255, 255, 255, 0.12)", e.beginPath();
		for (let t = 1; t < 4; t++) {
			let [n] = D(t / 4, 0), [, r] = D(0, t / 4);
			e.moveTo(n, O), e.lineTo(n, 160), e.moveTo(O, r), e.lineTo(244, r);
		}
		if (e.stroke(), e.lineWidth = 1, e.strokeStyle = "rgba(255, 255, 255, 0.25)", e.beginPath(), n) {
			let [, t] = D(0, i);
			e.moveTo(O, t), e.lineTo(244, t);
		} else e.moveTo(...D(0, 0)), e.lineTo(...D(1, 1));
		e.stroke();
		let t = new Path2D();
		for (let e = 0; e < re; e++) {
			let n = e / 255, [r, i] = D(n, Math.min(Math.max(_(n), 0), 1));
			e === 0 ? t.moveTo(r, i) : t.lineTo(r, i);
		}
		if (e.lineWidth = 3, e.strokeStyle = "rgba(0, 0, 0, 0.5)", e.stroke(t), e.lineWidth = 1.5, e.strokeStyle = "rgba(240, 240, 240, 0.95)", e.stroke(t), g.forEach((t, n) => {
			let [r, i] = D(t.x, t.y), a = n === c || n === u;
			e.beginPath(), e.arc(r, i, a ? 5 : 3.5, 0, 2 * Math.PI), e.fillStyle = a ? "rgba(240, 240, 240, 1)" : "rgba(30, 30, 30, 0.9)", e.fill(), e.lineWidth = 1.5, e.strokeStyle = a ? "rgba(30, 30, 30, 0.9)" : "rgba(240, 240, 240, 0.95)", e.stroke();
		}), a) for (let t = 0; t < 48; t++) e.fillStyle = se((t + .5) / 48), e.fillRect(O + t * ae / 48, 170, 5.416666666666667, ne);
	});
	let ce = (e) => {
		let r = k(e);
		if (e.button !== 0 || !r) return;
		let [i, a] = r, o = A(i, a);
		if (o >= 0) f.current = {
			node: o,
			moved: !1
		}, d(o);
		else if (g.length > 0 || n) {
			let e = x(t, n, i, a);
			if (e.index < 0) return;
			y(e.curve), f.current = {
				node: e.index,
				moved: !0
			}, d(e.index);
		} else return;
		e.currentTarget.setPointerCapture?.(e.pointerId);
	}, le = (e) => {
		let r = k(e);
		if (!r) return;
		let [i, a] = r, o = f.current;
		o ? (o.moved = !0, y(b(t, n, o.node, i, a))) : l(A(i, a));
	}, ue = () => {
		let t = f.current;
		f.current = null, t?.moved && e.onCommit();
	}, de = (r) => {
		y(S(t, n, r)), e.onCommit(), d(-1), l(-1);
	}, fe = (e) => {
		e.preventDefault();
		let t = k(e), n = t ? A(t[0], t[1]) : -1;
		n >= 0 && de(n);
	}, pe = (r) => {
		let i = u >= 0 ? u : c, a = g[i];
		if (!a || f.current) return;
		if (r.key === "Delete" || r.key === "Backspace") {
			r.preventDefault(), de(i);
			return;
		}
		let o = {
			ArrowUp: [0, v],
			ArrowDown: [0, -v],
			ArrowRight: [v, 0],
			ArrowLeft: [-v, 0]
		}[r.key];
		o && (r.preventDefault(), d(i), y(b(t, n, i, a.x + o[0], a.y + o[1])), e.onCommit());
	}, { NumberInput: me, Row: he } = E.ui, j = n && u >= 0 ? g[u] : void 0;
	return /* @__PURE__ */ T.createElement("div", null, /* @__PURE__ */ T.createElement("canvas", {
		ref: s,
		width: ee,
		height: o,
		role: "img",
		"aria-label": e.label,
		tabIndex: 0,
		style: {
			width: "100%",
			touchAction: "none"
		},
		onPointerDown: ce,
		onPointerMove: le,
		onPointerUp: ue,
		onPointerCancel: ue,
		onLostPointerCapture: ue,
		onPointerLeave: () => {
			f.current || l(-1);
		},
		onContextMenu: fe,
		onKeyDown: pe,
		onDoubleClick: () => {
			d(-1), e.onReset();
		}
	}), j ? /* @__PURE__ */ T.createElement(he, { gap: 6 }, /* @__PURE__ */ T.createElement(me, {
		"aria-label": "Left tangent",
		value: j.left,
		min: 0,
		max: 1,
		step: .01,
		onChange: (n) => {
			y(C(t, u, n, j.right)), e.onCommit();
		}
	}), /* @__PURE__ */ T.createElement(me, {
		"aria-label": "Right tangent",
		value: j.right,
		min: 0,
		max: 1,
		step: .01,
		onChange: (n) => {
			y(C(t, u, j.left, n)), e.onCommit();
		}
	})) : null);
}
//#endregion
//#region src/rt-plan.ts
var A = Math.fround;
function ce(e, t) {
	let n = [
		e,
		t,
		0,
		0,
		0,
		0
	], r = [0, 0];
	if (r[+(n[1] >= 1)] = 1, n[1] && (n[1] - 1) * (n[0] - 1) <= 0) {
		for (let e = 0; e < 99; e++) n[2] = (r[0] + r[1]) / 2, n[0] ? r[+(((n[2] / n[1]) ** +-n[0] - 1) / n[0] - 1 / n[2] > -1)] = n[2] : r[+(n[2] / Math.exp(1 - 1 / n[2]) < n[1])] = n[2];
		n[3] = n[2] / n[1], n[0] && (n[4] = n[2] * (1 / n[0] - 1));
	}
	return n;
}
function le(e, t, n, r) {
	let i = Math.max(n, 3), a = Array(e).fill(0);
	if (e === 1) a[0] = A(i / 2);
	else if (e === 2) a[1] = A(i / 2), a[0] = i;
	else {
		let n = A(i / e);
		if (t === 0) for (let t = 0; t < e; ++t) a[e - t - 1] = A(2 + A(t * n));
		else if (t === 1) {
			n = A(Math.log(i - 2) / e);
			for (let t = 0; t < e; ++t) a[e - t - 1] = A(2 + A(10 ** A(A(t * n) / Math.log(10))));
		} else if (t === 2) {
			n = A(Math.log(i - 2) / e);
			for (let t = 0; t < e; ++t) a[t] = A(i - A(10 ** A(A(t * n) / Math.log(10))));
		} else if (t === 3) {
			n = A(Math.log(i - 2) / e);
			for (let t = 0; t < e; ++t) a[t] = A(A(r * i) - A(10 ** A(A(t * n) / Math.log(10))));
		}
	}
	return a;
}
function ue(e) {
	return e.retinexMethod === "uni" ? 0 : e.retinexMethod === "low" ? 1 : 3;
}
var de = (e) => Math.trunc(A(A(2.8) * e));
function fe(e) {
	let t = e.retinexcolorspace === "HSLLIN", n = ue(e), r = de(e.neigh), i = A(e.vart / 100), a = A(e.str / 100), o = A(e.limd ** +A(1.7));
	t && (o = A(o * 10));
	let s = A(1 / o), c = A(49 / 99), l = A(A(1 - c) + A(c * e.highl)), u = e.scal, d = e.skal, f = [];
	for (let c = 1; c < e.iter + 1; c++) {
		let p = 1, m = d;
		if (u === 0) p = 1, m = 3;
		else if (u === 1) p = A(A(.25 * c) + .75), m = A(A(-.5 * c) + 4.5);
		else if (u === 2) p = A(A(.5 * c) + .5), m = A(A(-.75 * c) + 5.75);
		else if (u === 3) p = A(A(A(.666) * c) + A(.333)), m = A(A(-.75 * c) + 5.75);
		else if (u === 4) p = A(A(A(.8) * c) + A(.2)), m = A(A(-.75 * c) + 5.75);
		else if (u === 5) {
			if (n !== 3) p = A(A(2.5 * c) - 1.5);
			else {
				let e = A(A(A(11 * l) - 1) / 4);
				p = A(A(e * c) + A(1 - e));
			}
			m = A(A(-.75 * c) + 5.75);
		} else if (u === 6) {
			if (n !== 3) p = A(A(5 * c) - 4);
			else {
				let e = A(A(A(21 * l) - 1) / 4);
				p = A(A(e * c) + A(1 - e));
			}
			m = A(A(-.75 * c) + 5.75);
		} else u === -1 && (p = A(A(-.125 * c) + 1.125), m = 3);
		e.iter === 1 ? m = d : d < 3 ? (--m, m < 1 && (m = 1)) : d > 4 && (m += 1);
		let h = i, g = o, _ = s, v = e.grad, y = v === 1 ? A(A(-.125 * c) + 1.125) : v === 2 ? A(A(-.2 * c) + A(1.2)) : v === -1 ? A(A(.125 * c) + .875) : v === -2 ? A(A(.4 * c) + A(.6)) : 0;
		v !== 0 && y !== 0 && (h = A(i * y), g = A(o * y), _ = A(1 / g)), d = Math.round(m);
		let b = 1, x = e.grads;
		x === 1 ? b = c <= 3 ? A(A(A(-.3) * c) + A(1.6)) : .5 : x === 2 ? b = A(c <= 3 ? A(A(-.6) * c) + A(2.2) : .3) : x === -1 ? b = A(c <= 3 ? A(A(.2) * c) + A(.6) : 1.2) : x === -2 && (b = c <= 3 ? A(A(A(.4) * c) + A(.2)) : 1.5);
		let S = A(b * a), C = le(d, n, Math.trunc(A(r / p)), l), w = A(A(Math.log(16384)) / d);
		t || (w = A(w / Math.log(A(2.71828)))), f.push({
			it: c,
			scal: d,
			scales: C,
			pond: w,
			varx: h,
			limdx: g,
			ilimdx: _,
			strengthx: S
		});
	}
	return f;
}
var pe = 1122, me = (e, t) => 15 + (e.maskAt(e.n - 1 - t) ? 10 : 0) + 1;
function he(e) {
	let t = 9;
	for (let n = 0; n < e.n; n++) t += me(e, n);
	return e.hasTransmission && (t += 1 + +!!e.median + 8), t;
}
//#endregion
//#region src/model.ts
var j = [
	"low",
	"uniform",
	"high",
	"highlight",
	"highlightsPlus"
], ge = [
	"lab",
	"hslLog",
	"hslLinear"
], _e = [
	"none",
	"low",
	"middle",
	"high",
	"free"
], ve = [
	"none",
	"gaussian",
	"partial",
	"total"
], ye = [
	"standard",
	"unsharp",
	"mask",
	"transmissionAuto",
	"transmissionFixed"
], be = [
	"lightnessCurve",
	"lightnessCurveHsl",
	"maskCurve"
], xe = [
	"hueCurve",
	"transmissionCurve",
	"gainCurve"
], M = {
	strength: {
		min: 0,
		max: 100,
		step: 1
	},
	radius: {
		min: 6,
		max: 100,
		step: 1
	},
	contrast: {
		min: 50,
		max: 500,
		step: 1
	},
	highlightThreshold: {
		min: 1,
		max: 20,
		step: 1
	},
	protectFrom: {
		min: 0,
		max: 100,
		step: 1
	},
	protectSoftness: {
		min: 1,
		max: 50,
		step: 1
	},
	protectAmount: {
		min: 0,
		max: 100,
		step: 1
	},
	maskHighlights: {
		min: 0,
		max: 100,
		step: 1
	},
	maskHighlightsWidth: {
		min: 10,
		max: 100,
		step: 1
	},
	maskShadows: {
		min: 0,
		max: 100,
		step: 1
	},
	maskShadowsWidth: {
		min: 10,
		max: 100,
		step: 1
	},
	maskRadius: {
		min: 5,
		max: 100,
		step: 1
	},
	gammaValue: {
		min: .6,
		max: 3,
		step: .01
	},
	gammaSlope: {
		min: 1,
		max: 20,
		step: .1
	},
	iterations: {
		min: 1,
		max: 5,
		step: 1
	},
	scaleGradient: {
		min: -1,
		max: 6,
		step: 1
	},
	transmissionGradient: {
		min: -2,
		max: 2,
		step: 1
	},
	strengthGradient: {
		min: -2,
		max: 2,
		step: 1
	},
	scales: {
		min: 1,
		max: 8,
		step: 1
	},
	threshold: {
		min: 2,
		max: 100,
		step: 1
	},
	offset: {
		min: -1e3,
		max: 5e3,
		step: 1
	}
}, Se = [
	t.controlPoints,
	0,
	.5,
	.35,
	.35,
	.6,
	.75,
	.35,
	.35,
	1,
	.5,
	.35,
	.35
], Ce = [
	t.controlPoints,
	0,
	.1,
	.35,
	0,
	.25,
	.25,
	.35,
	.35,
	.7,
	.25,
	.35,
	.35,
	1,
	.1,
	0,
	0
], N = {
	on: !1,
	advanced: !1,
	method: "high",
	space: "lab",
	strength: 20,
	radius: 80,
	contrast: 200,
	highlightThreshold: 4,
	protectFrom: 70,
	protectSoftness: 20,
	protectAmount: 100,
	maskMethod: "none",
	maskHighlights: 0,
	maskHighlightsWidth: 80,
	maskShadows: 0,
	maskShadowsWidth: 80,
	maskRadius: 40,
	gamma: "none",
	gammaValue: 1.3,
	gammaSlope: 3,
	iterations: 1,
	scaleGradient: 3,
	transmissionGradient: 1,
	strengthGradient: 1,
	scales: 3,
	threshold: 8,
	median: !1,
	offset: 0,
	lightnessCurve: [e.linear],
	lightnessCurveHsl: [e.linear],
	maskCurve: [e.linear],
	hueCurve: [t.linear],
	transmissionCurve: Se,
	gainCurve: Ce
}, we = {
	low: "low",
	uniform: "uni",
	high: "high",
	highlight: "highli",
	highlightsPlus: "highliplus"
}, Te = {
	lab: "Lab",
	hslLog: "HSLLOG",
	hslLinear: "HSLLIN"
}, Ee = {
	none: "none",
	low: "low",
	middle: "mid",
	high: "hig",
	free: "fre"
}, De = {
	none: "none",
	gaussian: "gaus",
	partial: "map",
	total: "mapT"
}, Oe = {
	standard: "none",
	unsharp: "unsharp",
	mask: "mask",
	transmissionAuto: "tran",
	transmissionFixed: "tran2"
};
function ke(e, t = "standard") {
	return {
		cdcurve: e.lightnessCurve,
		cdHcurve: e.lightnessCurveHsl,
		lhcurve: e.hueCurve,
		transmissionCurve: e.transmissionCurve,
		gaintransmissionCurve: e.gainCurve,
		mapcurve: e.maskCurve,
		str: e.strength,
		scal: e.scaleGradient,
		iter: e.iterations,
		grad: e.transmissionGradient,
		grads: e.strengthGradient,
		gam: e.gammaValue,
		slope: e.gammaSlope,
		neigh: e.radius,
		offs: e.offset,
		highlights: e.maskHighlights,
		htonalwidth: e.maskHighlightsWidth,
		shadows: e.maskShadows,
		stonalwidth: e.maskShadowsWidth,
		radius: e.maskRadius,
		retinexMethod: we[e.method],
		retinexcolorspace: Te[e.space],
		gammaretinex: Ee[e.gamma],
		mapMethod: De[e.maskMethod],
		viewMethod: Oe[t],
		vart: e.contrast,
		limd: e.threshold,
		highl: e.highlightThreshold,
		skal: e.scales,
		medianmap: e.median,
		protectFrom: e.protectFrom,
		protectSoftness: e.protectSoftness,
		protectAmount: e.protectAmount
	};
}
var Ae = (e) => ({
	none: 0,
	gaussian: 4,
	partial: 2,
	total: 3
})[e.maskMethod];
function je(e) {
	let t = ke(e), n = Ae(e), r = d(e.transmissionCurve) !== null;
	return fe(t).map((t) => ({
		n: t.scal,
		sigma: t.scales,
		maskAt: (e) => t.it === 1 && (n === 3 || n === 4 || n === 2 && e > 2),
		hasTransmission: r,
		median: t.it === 1 && e.median
	}));
}
function Me(e) {
	if (!e.on) return {
		p1Draws: 0,
		p2Draws: 0,
		p3Draws: 0
	};
	let t = je(e);
	return {
		p1Draws: he(t[0]),
		p2Draws: t.slice(1).reduce((e, t) => e + he(t), 0),
		p3Draws: 1
	};
}
function Ne(e, t) {
	let n = +(e.gamma !== "none" && e.strength !== 0), r = {
		low: [
			1.15,
			.001692,
			2,
			1.000508,
			508e-6
		],
		middle: [
			1.3,
			.016613,
			2,
			1.009968,
			.009968
		],
		high: [
			1.45,
			.009115,
			3,
			1.012305,
			.012305
		]
	};
	if (e.gamma === "none") return [
		0,
		1,
		0,
		1,
		1,
		0,
		0,
		0
	];
	if (e.gamma !== "free") {
		let [i, a, o, s, c] = r[e.gamma];
		return [
			+!!t,
			i,
			a,
			o,
			s,
			c,
			0,
			n
		];
	}
	let i = 1 / e.gammaValue, a = e.gammaValue, o = e.gammaValue < 1;
	o && ([i, a] = [a, i]);
	let s = ce(i, e.gammaSlope), c = 1 + s[4], l, u;
	return t ? o ? (l = s[3], u = s[3]) : (l = s[2], u = s[4]) : (l = o ? s[2] : s[3], u = s[4]), [
		t ? +!o : +!!o,
		a,
		l,
		e.gammaSlope,
		c,
		u,
		1,
		n
	];
}
function Pe(e) {
	let t = u(e);
	if (!t) return {
		samples: Array(256).fill(0),
		ends: [
			0,
			0,
			0,
			0
		],
		on: !1
	};
	let n = [];
	for (let e = 0; e < 256; e++) {
		let r = e * 65535 / 255, i = Math.min(Math.floor(r), 65534);
		n.push((t[i] + (t[i + 1] - t[i]) * (r - i)) / 65535);
	}
	return {
		samples: n,
		ends: [
			t[0] / 65535,
			(t[1] - t[0]) / 65535,
			t[65534] / 65535,
			(t[65535] - t[65534]) / 65535
		],
		on: !0
	};
}
function Fe(e) {
	let t = d(e), n = Array(504).fill(0);
	if (t) for (let e = 0; e < 501; e++) n[e] = t[e];
	return {
		values: n,
		on: t !== null
	};
}
function Ie(e) {
	let t = f(e), n = [];
	for (let e = 0; e < 256; e++) n.push(t ? t.getVal(e / 256) : .5);
	return {
		samples: n,
		on: t !== null
	};
}
var P = 1001;
function Le(e) {
	let t = fe(ke(e)), n = e.space === "hslLinear" ? 0 : 1, r = Fe(e.transmissionCurve), i = Fe(e.gainCurve), a = Ie(e.hueCurve), o = Pe(e.space === "lab" ? e.lightnessCurve : e.lightnessCurveHsl), s = Pe(e.maskCurve), c = (e) => {
		let n = Array(8).fill(0);
		return t[e]?.scales.forEach((e, t) => n[t] = e), n;
	}, l = t[0], u = [];
	for (let e = 0; e < 5; e++) {
		let n = t[e];
		u.push(...c(e)), u.push(n?.scal ?? 0, n?.pond ?? 0, n?.limdx ?? 1, n?.ilimdx ?? 1), u.push(n?.varx ?? 0, n?.strengthx ?? 0, 0, e === 0 ? P : 0);
	}
	let d = j.indexOf(e.method);
	return {
		rtIt1: [
			...c(0),
			l.scal,
			l.pond,
			l.limdx,
			l.ilimdx,
			n,
			+!!r.on,
			+!!e.median,
			e.iterations
		],
		rtMask: [
			Ae(e),
			+!!s.on,
			e.maskHighlights,
			e.maskHighlightsWidth,
			e.maskShadows,
			e.maskShadowsWidth,
			e.maskMethod === "gaussian" ? e.maskRadius : 40,
			P
		],
		rtIters: u,
		rtFlags: [
			e.iterations,
			+!!r.on,
			+!!i.on,
			+!!a.on,
			n,
			d,
			e.offset,
			e.method === "highlight" && a.on ? 1 : 0,
			+!!e.median,
			0,
			0,
			P
		],
		rtProtect: [
			e.protectFrom,
			e.protectSoftness,
			e.protectAmount / 100,
			+(e.method === "highlightsPlus")
		],
		rtConv: [
			ge.indexOf(e.space),
			+!!o.on,
			+(e.gamma !== "none" && e.strength !== 0),
			0,
			P,
			0,
			0,
			0
		],
		rtGammaIn: Ne(e, !1),
		rtGammaOut: Ne(e, !0),
		rtCd: o.samples,
		rtCdEnds: o.ends,
		rtMap: s.samples,
		rtMapEnds: s.ends,
		rtTransA: r.values.slice(0, 252),
		rtTransB: r.values.slice(252),
		rtGainA: i.values.slice(0, 252),
		rtGainB: i.values.slice(252),
		rtHue: a.samples
	};
}
var Re = {
	rtIt1: 4,
	rtMask: 2,
	rtIters: 20,
	rtFlags: 3,
	rtProtect: 1,
	rtConv: 2,
	rtGammaIn: 2,
	rtGammaOut: 2,
	rtCd: 64,
	rtCdEnds: 1,
	rtMap: 64,
	rtMapEnds: 1,
	rtTransA: 63,
	rtTransB: 63,
	rtGainA: 63,
	rtGainB: 63,
	rtHue: 64
}, ze = "retinex", F = `${ze}.msr`, Be = Object.keys(M), I = [
	"method",
	"space",
	"gamma",
	"maskMethod"
], L = [
	"on",
	"advanced",
	"median"
], R = [...be, ...xe], Ve = [
	...L,
	...I,
	...Be,
	...R
], He = [
	"p1Draws",
	"p2Draws",
	"p3Draws"
], Ue = "view", We = "viewP1", Ge = {
	method: j,
	space: ge,
	gamma: _e,
	maskMethod: ve
}, Ke = (e) => xe.includes(e), qe = (e) => Ke(e) ? 25 : 17;
function Je(e, t) {
	let n = 4 * qe(e), r = t.slice(1, n - 1), i = [
		t[0] ?? 0,
		r.length,
		...r
	];
	for (; i.length < n;) i.push(0);
	return i;
}
function Ye(n, r) {
	if (!Array.isArray(r) || r.length !== 4 * qe(n) || !r.every((e) => typeof e == "number" && Number.isFinite(e))) return null;
	let i = Math.max(0, Math.min(Math.trunc(r[1]), r.length - 2)), a = r[0], o = r.slice(2, 2 + i), s = Ke(n);
	if (s ? a === t.linear : a === e.linear) return [a];
	if (!(s ? [t.controlPoints] : [
		e.spline,
		e.parametric,
		e.nurbs,
		e.catmullRom
	]).includes(a)) return null;
	if (a === e.parametric && !s) return o.length >= 7 ? [a, ...o] : null;
	let c = (e) => Math.min(Math.max(e, 0), 1), l = p([a, ...o], s).map((e) => ({
		x: c(e.x),
		y: c(e.y),
		left: c(e.left),
		right: c(e.right)
	})).sort((e, t) => e.x - t.x).filter((e, t, n) => t === 0 || e.x > n[t - 1].x);
	return l.length >= (s ? 1 : 2) ? m(a, l, s) : null;
}
var z = (e) => `${F}.${e}`, Xe = (e) => typeof e == "number" && Number.isFinite(e);
function B(e) {
	let t = { ...N };
	for (let n of L) {
		let r = e[z(n)];
		typeof r == "boolean" ? t[n] = r : Xe(r) && (t[n] = r >= .5);
	}
	for (let n of I) {
		let r = e[z(n)], i = Ge[n], a = Xe(r) ? Math.round(r) : -1;
		a >= 0 && a < i.length && (t[n] = i[a]);
	}
	for (let n of Be) {
		let r = e[z(n)];
		Xe(r) && (t[n] = Math.min(Math.max(r, M[n].min), M[n].max));
	}
	for (let n of R) {
		let r = Ye(n, e[z(n)]);
		r && (t[n] = r);
	}
	return t;
}
function V(e, t) {
	return L.includes(t) ? e[t] : I.includes(t) ? Ge[t].indexOf(e[t]) : R.includes(t) ? Je(t, e[t]) : e[t];
}
function Ze(e) {
	let t = Me(e), n = {};
	for (let e of He) n[z(e)] = t[e];
	let r = e.on ? Le(e) : null;
	for (let e of Object.keys(Qe)) n[z(e)] = r ? r[e] : void 0;
	return n;
}
var Qe = Le({
	...N,
	on: !0
});
Object.keys(Qe);
function $e(e) {
	let t = {};
	for (let n of Ve) t[z(n)] = V(e, n);
	return {
		...t,
		...Ze(e)
	};
}
function et(e, t) {
	let n = {};
	for (let r of t) n[z(r)] = V(e, r);
	return {
		...n,
		...Ze(e)
	};
}
var tt = (e, t) => Array.isArray(e) && Array.isArray(t) ? e.length === t.length && e.every((e, n) => Object.is(e, t[n]) || Math.abs(e - t[n]) < 1e-9) : e === t;
function nt(e) {
	if (![...Ve, ...He].some((t) => z(t) in e)) return null;
	let t = Ze(B(e));
	return Object.entries(t).every(([t, n]) => tt(e[t], n)) ? null : t;
}
var rt = () => $e(N);
//#endregion
//#region src/glsl.ts
function it(e) {
	let t = e.toPrecision(10);
	if (/e/i.test(t)) {
		let [e, n] = t.split(/e/i);
		return `${e.includes(".") ? e : `${e}.0`}e${Number(n)}`;
	}
	return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, ".0") : `${t}.0`;
}
var H = it, U = {
	idle: 0,
	start: 1,
	reduce: 2,
	box: 3,
	shmap1: 4,
	shmap2: 5,
	maskStats: 6,
	accumulate: 7,
	stats1: 8,
	transmission: 9,
	median: 10,
	stats2: 11,
	final: 12,
	flag: 13
}, at = -1e4, ot = -4096, st = [
	[
		.4360747,
		.3850649,
		.1430804
	],
	[
		.2225045,
		.7168786,
		.0606169
	],
	[
		.0139322,
		.0971045,
		.7141733
	]
];
function ct(e) {
	let [t, n, r] = e, i = t[0] * (n[1] * r[2] - n[2] * r[1]) - t[1] * (n[0] * r[2] - n[2] * r[0]) + t[2] * (n[0] * r[1] - n[1] * r[0]);
	return [
		[
			(n[1] * r[2] - n[2] * r[1]) / i,
			(t[2] * r[1] - t[1] * r[2]) / i,
			(t[1] * n[2] - t[2] * n[1]) / i
		],
		[
			(n[2] * r[0] - n[0] * r[2]) / i,
			(t[0] * r[2] - t[2] * r[0]) / i,
			(t[2] * n[0] - t[0] * n[2]) / i
		],
		[
			(n[0] * r[1] - n[1] * r[0]) / i,
			(t[1] * r[0] - t[0] * r[1]) / i,
			(t[0] * n[1] - t[1] * n[0]) / i
		]
	];
}
var lt = [
	[
		1.6473376,
		-.3935675,
		-.2359961
	],
	[
		-.6826036,
		1.6475887,
		.012819
	],
	[
		.0296524,
		-.0628993,
		1.2531279
	]
], ut = (e) => `mat3(${[
	0,
	1,
	2
].flatMap((t) => [
	0,
	1,
	2
].map((n) => H(e[n][t]))).join(", ")})`, dt = .5323, ft = 1.2015, W = .0293, pt = -.4781, mt = 1.9616, ht = .2281, G = +.051500000000000073.toFixed(4), K = 24389 / 27, gt = 14155560 / 24389, _t = `
highp ivec2 rtSize() { return ivec2(floor(1.0 / uTexel + 0.5)); }
float rtK() {
  vec2 pass = floor(1.0 / uTexel + 0.5);
  float source = max(uSourceSize.x, uSourceSize.y);
  return source > 0.0 ? max(pass.x, pass.y) / source : 1.0;
}
vec4 rtOneHot(highp int i) { return vec4(equal(ivec4(i), ivec4(0, 1, 2, 3))); }
float rtQuantize(float v) {
  if (abs(v) < ${H(2 ** -14)}) return 0.0;
  return uintBitsToFloat((floatBitsToUint(v) + 0x1000u) & 0xFFFFE000u);
}
float rtHalf(float v) {
  float c = clamp(v, -65000.0, 65000.0);
  if (abs(c) < ${H(2 ** -14)}) return floor(c * ${H(2 ** 24)} + 0.5) * ${H(2 ** -24)};
  return rtQuantize(c);
}
highp ivec2 rtAt(highp int n) {
  highp int w = rtSize().x;
  highp int row = n / w;
  return ivec2(n - row * w, row);
}
vec4 rtFetch(highp int n) { return fetchPrev4(rtAt(n)); }
highp int rtCells(highp int n, int level) { return (n + (1 << level) - 1) >> level; }
highp int rtTileSize(int level) { highp ivec2 s = rtSize(); return rtCells(s.x, level) * rtCells(s.y, level); }
highp int rtTileBase(int level) {
  highp int base = 0;
  for (int i = 1; i <= 6; i++) {
    if (i >= level) break;
    base += 2 * rtTileSize(i);
  }
  return base;
}
highp int rtStatsBase() { return rtTileBase(7); }
highp int rtGridDiv(highp int n, int l) { highp int d = 1 << (2 * (l + 1)); return (n + d - 1) / d; }
int rtStatsDepth(highp int gw, highp int gh) {
  for (int l = 0; l < 8; l++) {
    if (rtGridDiv(gw, l) <= 1 && rtGridDiv(gh, l) <= 1) return l + 1;
  }
  return 9;
}
highp int rtTreeBase(highp int gw, highp int gh, int l, int tree) {
  highp int base = rtStatsBase();
  for (int i = 0; i < 8; i++) {
    if (i >= l) break;
    base += 4 * rtGridDiv(gw, i) * rtGridDiv(gh, i);
  }
  return base + tree * rtGridDiv(gw, l) * rtGridDiv(gh, l);
}
bool rtFits() {
  highp ivec2 s = rtSize();
  int depth = rtStatsDepth(s.x, s.y);
  return depth <= 8 && rtTreeBase(s.x, s.y, depth - 1, 0) <= s.x * s.y && 35 <= s.x * s.y;
}
// gaussianBlur's box sizing (gauss.cc 1379-1418) at the pass size.
int rtBoxCount(float sigma, out int wl, out int m) {
  highp ivec2 s = rtSize();
  float W = float(s.x);
  float H = float(s.y);
  float v = 12.0 * sigma * sigma;
  int n = 1;
  float w = sqrt(v + 1.0);
  for (int i = 0; i < 4096; i++) {
    if (!(w > W || w > H)) break;
    n++;
    w = sqrt(v / float(n) + 1.0);
  }
  if (n < 3) {
    n = 3;
    w = sqrt(v / 3.0 + 1.0);
  } else if (n > 6) {
    n = 6;
  }
  wl = int(floor(w));
  if (wl - 2 * (wl / 2) == 0) wl--;
  float fl = float(wl);
  float mIdeal = (v - float(n) * fl * fl - 4.0 * float(n) * fl - 3.0 * float(n)) / (-4.0 * fl - 4.0);
  m = int(sign(mIdeal) * floor(abs(mIdeal) + 0.5 + 1e-5));
  return n;
}
int rtBoxRadius(float sigma, int box) {
  int wl;
  int m;
  int n = rtBoxCount(sigma, wl, m);
  if (box >= n) return -1;
  highp ivec2 s = rtSize();
  return min(((box < m ? wl : wl + 2) - 1) / 2, min(s.x, s.y) - 1);
}
// The fractional box with variance v (cells²): ones out to m, t at m + 1.
vec2 rtFractional(float v) {
  if (v <= 0.0) return vec2(0.0);
  float m = max(0.0, floor((-1.0 + sqrt(1.0 + 12.0 * v)) / 2.0));
  float t = (v * (2.0 * m + 1.0) - m * (m + 1.0) * (2.0 * m + 1.0) / 3.0) / (2.0 * (m + 1.0) * (m + 1.0) - 2.0 * v);
  return vec2(m, clamp(t, 0.0, 0.999999));
}
`, vt = {
	1: `
float rtSigma(int it, int s) { return dot(rtIt1[s >> 2], rtOneHot(s & 3)); }
int rtScales(int it) { return int(rtIt1[2].x + 0.5); }
float rtPond(int it) { return rtIt1[2].y; }
float rtLimit(int it) { return rtIt1[2].z; }
float rtLimitInv(int it) { return rtIt1[2].w; }
bool rtLogMode() { return rtIt1[3].x > 0.5; }
bool rtHasTrans() { return rtIt1[3].y > 0.5; }
bool rtMedianAt(int it) { return it == 1 && rtIt1[3].z > 0.5; }
int rtIterCount() { return int(rtIt1[3].w + 0.5); }
int rtMapMet() { return int(rtMask[0].x + 0.5); }
bool rtMarked() { return rtConv[1].x == ${H(P)} && rtMask[1].w == ${H(P)}; }
bool rtMaskAt(int it, int s) {
  int met = rtMapMet();
  return it == 1 && (met == 3 || met == 4 || (met == 2 && s > 2));
}
// The blur plane and tiles keep their low halves in G while no mask, whose
// statistics G holds, runs.
bool rtLo() { return rtMapMet() == 0; }
const int RT_FIRST = 1;
int rtLastIt() { return 1; }
`,
	2: `
float rtIter(int it, int k) { return dot(rtIters[(it - 1) * 4 + (k >> 2)], rtOneHot(k & 3)); }
float rtSigma(int it, int s) { return rtIter(it, s); }
int rtScales(int it) { return int(rtIter(it, 8) + 0.5); }
float rtPond(int it) { return rtIter(it, 9); }
float rtLimit(int it) { return rtIter(it, 10); }
float rtLimitInv(int it) { return rtIter(it, 11); }
float rtVarx(int it) { return rtIter(it, 12); }
float rtStrengthx(int it) { return rtIter(it, 13); }
bool rtLogMode() { return rtFlags[1].x > 0.5; }
bool rtHasTrans() { return rtFlags[0].y > 0.5; }
bool rtMedianAt(int it) { return false; }
int rtIterCount() { return int(rtFlags[0].x + 0.5); }
bool rtMaskAt(int it, int s) { return false; }
bool rtMarked() { return rtConv[1].x == ${H(P)} && rtIters[3].w == ${H(P)} && rtFlags[2].w == ${H(P)}; }
// G holds the iteration's source: the blurs are single halves.
bool rtLo() { return false; }
const int RT_FIRST = 2;
int rtLastIt() { return rtIterCount(); }
`,
	3: `
float rtIter(int it, int k) { return dot(rtIters[(it - 1) * 4 + (k >> 2)], rtOneHot(k & 3)); }
float rtVarx(int it) { return rtIter(it, 12); }
float rtStrengthx(int it) { return rtIter(it, 13); }
bool rtHasTrans() { return rtFlags[0].y > 0.5; }
int rtIterCount() { return int(rtFlags[0].x + 0.5); }
bool rtMarked() { return rtConv[1].x == ${H(P)} && rtIters[3].w == ${H(P)} && rtFlags[2].w == ${H(P)}; }
`
}, yt = `
struct RtStep {
  int kind;
  int it;
  int j;
  int sub;
};
int rtScaleSlots(int it, int j) {
  return 15 + (rtMaskAt(it, rtScales(it) - 1 - j) ? 10 : 0) + 1;
}
int rtIterSlots(int it) {
  int n = rtScales(it);
  int slots = 9;
  for (int j = 0; j < 8; j++) {
    if (j >= n) break;
    slots += rtScaleSlots(it, j);
  }
  if (rtHasTrans()) slots += 1 + (rtMedianAt(it) ? 1 : 0) + 8;
  return slots;
}
int rtPassSlots() {
  int slots = 0;
  for (int it = 1; it <= 5; it++) {
    if (it < RT_FIRST || it > rtLastIt()) continue;
    slots += rtIterSlots(it);
  }
  return slots;
}
bool rtCountsFit() { return rtMarked() && rtPassSlots() == uPassCount && rtFits(); }
RtStep rtStepAt(int slot) {
  RtStep idle = RtStep(${U.idle}, 0, 0, 0);
  if (!rtCountsFit()) return RtStep(${U.flag}, 0, 0, 0);
  int o = slot;
  for (int it = 1; it <= 5; it++) {
    if (it < RT_FIRST || it > rtLastIt()) continue;
    int count = rtIterSlots(it);
    if (o >= count) {
      o -= count;
      continue;
    }
    if (o == 0) return RtStep(${U.start}, it, 0, 0);
    o -= 1;
    int n = rtScales(it);
    for (int j = 0; j < 8; j++) {
      if (j >= n) break;
      int size = rtScaleSlots(it, j);
      if (o < size) {
        if (o < 3) return RtStep(${U.reduce}, it, j, o);
        o -= 3;
        if (o < 12) return RtStep(${U.box}, it, j, o);
        o -= 12;
        if (rtMaskAt(it, n - 1 - j)) {
          if (o == 0) return RtStep(${U.shmap1}, it, j, 0);
          if (o == 1) return RtStep(${U.shmap2}, it, j, 0);
          if (o < 10) return RtStep(${U.maskStats}, it, j, o - 2);
          o -= 10;
        }
        return RtStep(${U.accumulate}, it, j, 0);
      }
      o -= size;
    }
    if (o < 8) return RtStep(${U.stats1}, it, 0, o);
    o -= 8;
    if (o == 0) return RtStep(${U.transmission}, it, 0, 0);
    o -= 1;
    if (rtMedianAt(it)) {
      if (o == 0) return RtStep(${U.median}, it, 0, 0);
      o -= 1;
    }
    return RtStep(${U.stats2}, it, 0, o);
  }
  return idle;
}
float rtIncrement(int it, int j) {
  int s = rtScales(it) - 1 - j;
  float a = rtSigma(it, s);
  if (j == 0) return a * rtK();
  float b = rtSigma(it, s + 1);
  return sqrt(max(a * a - b * b, 0.0)) * rtK();
}
// The largest radius of chain position j's boxes.
highp int rtMaxRadius(int it, int j) {
  int wl;
  int m;
  int n = rtBoxCount(rtIncrement(it, j), wl, m);
  highp ivec2 s = rtSize();
  return min(((m < n ? wl + 2 : wl) - 1) / 2, min(s.x, s.y) - 1);
}
// schedule.ts levelAt: the finest level whose boxes stay within their reads,
// never finer than the scale before.
int rtLevel(int it, int j) {
  int level = 0;
  for (int i = 0; i < 8; i++) {
    if (i > j) break;
    highp int r = rtMaxRadius(it, i);
    if (level == 0 && r <= 17) continue;
    level = max(level, 1);
    for (int k = 0; k < 6; k++) {
      highp int limit = ${pe} << (2 * level);
      if (level >= 6 || r * (r + 1) < limit) break;
      level++;
    }
  }
  return level;
}
// The reduction the step's sub-slot makes into chain position j: from, to (or -1).
ivec2 rtReduction(int it, int j, int sub) {
  int to = rtLevel(it, j);
  int from = j == 0 ? 0 : rtLevel(it, j - 1);
  for (int r = 0; r < 3; r++) {
    if (to - from < 1) break;
    int next = to - from >= 2 ? from + 2 : to;
    if (r == sub) return ivec2(from, next);
    from = next;
  }
  return ivec2(-1);
}
// Rows [from, to) of a linear range, or (0, 0).
ivec2 rtRows(highp int from, highp int to) {
  if (to <= from) return ivec2(0);
  highp int w = rtSize().x;
  return ivec2(from / w, (to - 1) / w + 1);
}
const ivec2 RT_WHOLE = ivec2(-1, -1);
ivec2 rtStatsRows(highp int gw, highp int gh, int l, highp int last) {
  int depth = rtStatsDepth(gw, gh);
  if (l >= depth) return ivec2(0);
  if (l == depth - 1) return rtRows(0, last);
  return rtRows(rtTreeBase(gw, gh, l, 0), rtTreeBase(gw, gh, l, 4));
}
// The rows a step writes: (0, 0) none, RT_WHOLE the frame.
ivec2 rtWrites(RtStep st) {
  highp ivec2 s = rtSize();
  int k = st.kind;
  if (k == ${U.idle}) return ivec2(0);
  if (k == ${U.flag}) return rtRows(34, 35);
  if (k == ${U.start} || k == ${U.accumulate} || k == ${U.transmission} || k == ${U.median} || k == ${U.final}) return RT_WHOLE;
  if (k == ${U.reduce}) {
    ivec2 r = rtReduction(st.it, st.j, st.sub);
    if (r.y < 0) return ivec2(0);
    highp int base = rtTileBase(r.y);
    return rtRows(base, base + rtTileSize(r.y));
  }
  if (k == ${U.box}) {
    if (rtBoxRadius(rtIncrement(st.it, st.j), st.sub >> 1) < 0) return ivec2(0);
    int level = rtLevel(st.it, st.j);
    if (level == 0) return RT_WHOLE;
    highp int base = rtTileBase(level) + ((st.sub & 1) == 1 ? 0 : rtTileSize(level));
    return rtRows(base, base + rtTileSize(level));
  }
  if (k == ${U.shmap1} || k == ${U.shmap2}) return rtLevel(st.it, st.j) == 0 ? RT_WHOLE : ivec2(0);
  if (k == ${U.maskStats}) {
    int level = rtLevel(st.it, st.j);
    return rtStatsRows(rtCells(s.x, level), rtCells(s.y, level), st.sub, 3);
  }
  return rtStatsRows(s.x, s.y, st.sub, 35);
}
`, bt = "\nivec4 rtRegion() {\n  highp ivec2 s = rtSize();\n  if (uPassIndex == 0) return ivec4(0, 0, s);\n  ivec2 now = rtWrites(rtStepAt(uPassIndex));\n  ivec2 before = rtWrites(rtStepAt(uPassIndex - 1));\n  if (now == RT_WHOLE || before == RT_WHOLE) return ivec4(0, 0, s);\n  bool hasNow = now.y > now.x;\n  bool hasBefore = before.y > before.x;\n  if (!hasNow && !hasBefore) return ivec4(0);\n  ivec2 rows = !hasNow ? before : !hasBefore ? now : ivec2(min(now.x, before.x), max(now.y, before.y));\n  return ivec4(0, rows.x, s.x, rows.y);\n}\n", xt = `
float rtUnbase(float y) {
  if (y >= 1.0) return y;
  if (y <= 0.0) return y * ${H(G / W)};
  float c = y * y;
  float a = ${H(dt)} - y * ${H(pt)};
  float b = ${H(ft)} - y * ${H(mt)};
  float k = ${H(W)} - y * ${H(ht)};
  for (int i = 0; i < 6; i++) {
    float p = ((a * c + b) * c + k) * c - y * ${H(G)};
    float dp = (3.0 * a * c + 2.0 * b) * c + k;
    c = clamp(c - p / dp, 0.0, 1.0);
  }
  return c;
}
vec3 rtLinear(vec3 lin) {
  return uApplyBaseCurve ? vec3(rtUnbase(lin.r), rtUnbase(lin.g), rtUnbase(lin.b)) : lin;
}
// gammareti (form 0) / igammareti (form 1), color.h 1284-1291, on 0..1.
float rtGammaFn(float x, vec4 g0, vec4 g1) {
  if (g0.x < 0.5) return x <= g0.z ? x * g0.w : exp(log(x) / g0.y) * g1.x - g1.y;
  return x <= g0.z * g0.w ? x / g0.w : exp(log((x + g1.y) / g1.x) * g0.y);
}
// A gamma table looked up as LUTf does: free tables clip their entries and
// their index, fixed ones extrapolate the end segments.
float rtGammaLut(float v, vec4 g0, vec4 g1) {
  bool clip = g1.z > 0.5;
  if (clip) {
    if (v < 0.0) return clamp(65535.0 * rtGammaFn(0.0, g0, g1), 0.0, 65535.0);
    if (v > 65534.0) return clamp(65535.0 * rtGammaFn(1.0, g0, g1), 0.0, 65535.0);
    return clamp(65535.0 * rtGammaFn(v / 65535.0, g0, g1), 0.0, 65535.0);
  }
  if (v > 65534.0) {
    float a = 65535.0 * rtGammaFn(${H(65534 / 65535)}, g0, g1);
    float b = 65535.0 * rtGammaFn(1.0, g0, g1);
    return a + (b - a) * (v - 65534.0);
  }
  return 65535.0 * rtGammaFn(v / 65535.0, g0, g1);
}
vec3 rtApplyGammaIn(vec3 rgb) {
  if (rtConv[0].z < 0.5) return rgb;
  return vec3(rtGammaLut(rgb.r, rtGammaIn[0], rtGammaIn[1]), rtGammaLut(rgb.g, rtGammaIn[0], rtGammaIn[1]), rtGammaLut(rgb.b, rtGammaIn[0], rtGammaIn[1]));
}
float rtCbrt(float v) {
  float r = exp2(log2(v) / 3.0);
  return r - (r * r * r - v) / (3.0 * r * r);
}
// Color::computeXYZ2Lab / computeXYZ2LabY (color.cc 1715-1724, color.h 177-186).
float rtLabF(float v) {
  if (v <= ${H(gt)}) return 327.68 * ((${H(K)} * v / 65535.0 + 16.0) / 116.0);
  return 327.68 * rtCbrt(v / 65535.0);
}
float rtLabY(float v) {
  if (v <= ${H(gt)}) return 327.68 * (${H(K)} * v / 65535.0);
  return 327.68 * (116.0 * rtCbrt(v / 65535.0) - 16.0);
}
float rtAtan2(float y, float x) { return x == 0.0 && y == 0.0 ? 0.0 : atan(y, x); }
// The pixel as retinexPrepareBuffers holds it: L (RawTherapee units, before
// L=f(L)), then a, b (Lab) or h, s (HSL), and the hue buffer.
struct RtPixel {
  float L;
  float c0;
  float c1;
  float hue;
};
RtPixel rtAnalyse(vec3 rgb) {
  int space = int(rtConv[0].x + 0.5);
  if (space == 0) {
    vec3 xyz = ${ut(st)} * rgb;
    float fx = rtLabF(xyz.x / 0.9642);
    float fy = rtLabF(xyz.y);
    float fz = rtLabF(xyz.z / 0.8249);
    float a = 500.0 * (fx - fy);
    float b = 200.0 * (fy - fz);
    return RtPixel(rtLabY(xyz.y), a, b, rtAtan2(b, a));
  }
  float mx = max(rgb.r, max(rgb.g, rgb.b));
  float mn = min(rgb.r, min(rgb.g, rgb.b));
  float C = mx - mn;
  float sum = mx + mn;
  float l = sum * 7.6295109e-6;
  float h = 0.0;
  float s = 0.0;
  if (C >= 0.65535) {
    s = l <= 0.5 ? (sum != 0.0 ? C / sum : 0.0) : (sum >= 131070.0 ? 0.0 : C / (131070.0 - sum));
    if (rgb.r == mx) h = rgb.g - rgb.b;
    else if (rgb.g == mx) h = 2.0 * C + rgb.b - rgb.r;
    else h = 4.0 * C + rgb.r - rgb.g;
    h /= 6.0 * C;
    if (h < 0.0) h += 1.0;
  }
  return RtPixel(l * 32768.0, h, s, h);
}
RtPixel rtPixelAt(ivec2 texel) {
  return rtAnalyse(rtApplyGammaIn(65535.0 * rtLinear(fetchInput(texel))));
}
`, q = (e, t, n) => `
float ${e}(int i) {
  int k = clamp(i, 0, ${n - 1});
  return dot(${t}[k >> 2], rtOneHot(k & 3));
}`, J = (e, t, n, r) => `
float ${e}(float u) {
  float x = ${r ? `fract(u) * ${H(n)}` : `clamp(u, 0.0, 1.0) * ${H(n - 1)}`};
  float i0 = floor(x);
  float t = x - i0;
  int i = int(i0);
  ${r ? `float p0 = ${t}(i - 1 < 0 ? i - 1 + ${n} : i - 1);
  float p1 = ${t}(i);
  float p2 = ${t}(i + 1 >= ${n} ? i + 1 - ${n} : i + 1);
  float p3 = ${t}(i + 2 >= ${n} ? i + 2 - ${n} : i + 2);` : `float p0 = ${t}(max(i - 1, 0));
  float p1 = ${t}(i);
  float p2 = ${t}(min(i + 1, ${n - 1}));
  float p3 = ${t}(min(i + 2, ${n - 1}));`}
  return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3 + t * (3.0 * (p1 - p2) + p3 - p0)));
}`, St = (e, t, n) => `
float ${e}(float x) {
  if (x < 0.0) return 65535.0 * (${n}.x + ${n}.y * x);
  if (x > 65534.0) return 65535.0 * (${n}.z + ${n}.w * (x - 65534.0));
  return 65535.0 * ${t}(x / 65535.0);
}`, Ct = (e, t, n) => `
float ${e}At(int i) {
  int k = clamp(i, 0, 503);
  return k < 252 ? dot(${t}[k >> 2], rtOneHot(k & 3)) : dot(${n}[(k - 252) >> 2], rtOneHot((k - 252) & 3));
}
float ${e}(float absc) {
  if (absc < 0.0) return ${e}At(0);
  if (absc > 499.0) return ${e}At(500);
  float i0 = floor(absc);
  int i = int(i0);
  float p1 = ${e}At(i);
  return p1 + (${e}At(i + 1) - p1) * (absc - i0);
}`, wt = `${q("rtCdAt", "rtCd", 256)}${J("rtCdSample", "rtCdAt", 256, !1)}${St("rtCdLut", "rtCdSample", "rtCdEnds")}
${q("rtMapAt", "rtMap", 256)}${J("rtMapSample", "rtMapAt", 256, !1)}${St("rtMapLut", "rtMapSample", "rtMapEnds")}
${Ct("rtTrans", "rtTransA", "rtTransB")}
// The working lightness: L=f(L) as cdcurve[2L] / 2 (rawimagesource.cc:2320).
float rtWork(float L) { return rtConv[0].y > 0.5 ? 0.5 * rtCdLut(2.0 * L) : L; }
float rtSourceAt(ivec2 texel) { return (rtWork(rtPixelAt(texel).L) + 2.0) / 327.68; }
`, Tt = `${Ct("rtTrans", "rtTransA", "rtTransB")}
${Ct("rtGain", "rtGainA", "rtGainB")}
${q("rtHueAt", "rtHue", 256)}${J("rtHueCurve", "rtHueAt", 256, !0)}
`, Et = `${Ct("rtGain", "rtGainA", "rtGainB")}
${q("rtHueAt", "rtHue", 256)}${J("rtHueCurve", "rtHueAt", 256, !0)}
`, Dt = "\n// Bank texel 2q holds statistic q's high half, 2q + 1 its low half; texel 16\n// the iteration that wrote the bank.\nfloat rtBank(int it, int q) {\n  highp int base = (it & 1) * 17 + 2 * q;\n  return rtFetch(base).a + rtFetch(base + 1).a;\n}\nfloat rtBankTag(int it) { return rtFetch((it & 1) * 17 + 16).a; }\n// The log map: R holds its high half, A its low half (none on the bank texels).\nfloat rtMapOf(vec4 v, highp int n) { return v.r + (n < 35 ? 0.0 : v.a); }\n// The transmission and gain curves' abscissa (ipretinex.cc 561-593, 677-715).\nfloat rtAbsciss(float l, float mean, float std, float mn, float mx) {\n  if (abs(l - mean) < std) {\n    float a = 0.166666 / std;\n    return 500.0 * a * l + 500.0 * (0.5 - a * mean);\n  }\n  if (l >= mean) {\n    float a = 0.333333 / (mx - mean - std);\n    return 500.0 * a * l + 500.0 * (1.0 - a * mx);\n  }\n  float a = 0.333333 / (mean - std - mn);\n  return 500.0 * a * l - 500.0 * a * mn;\n}\n// Color::huelab_to_huehsv2 (color.h:1914-1947).\nfloat rtHueOf(float HH) {\n  float hr = 0.0;\n  if (HH >= 0.0 && HH < 0.6) hr = 0.11666 * HH + 0.93;\n  else if (HH >= 0.6 && HH < 1.4) hr = 0.1125 * HH - 0.0675;\n  else if (HH >= 1.4 && HH < 2.0) hr = 0.2666 * HH - 0.2833;\n  else if (HH >= 2.0 && HH < 3.14159) hr = 0.1489 * HH - 0.04785;\n  else if (HH >= -3.14159 && HH < -2.8) hr = 0.23419 * HH + 1.1557;\n  else if (HH >= -2.8 && HH < -2.3) hr = 0.16 * HH + 0.948;\n  else if (HH >= -2.3 && HH < -0.9) hr = 0.12143 * HH + 0.85928;\n  else if (HH >= -0.9 && HH < -0.1) hr = 0.2125 * HH + 0.94125;\n  else if (HH >= -0.1 && HH < 0.0) hr = 0.1 * HH + 0.93;\n  if (hr < 0.0) hr += 1.0;\n  else if (hr > 1.0) hr -= 1.0;\n  return hr;\n}\n", Ot = `
float rtChannel(vec4 v, int ch) { return dot(v, rtOneHot(ch)); }
// Pixel count of node or cell i along an axis of n pixels, blocks of b pixels.
float rtCount(highp int n, highp int b, highp int i) { return float(clamp(n - b * i, 0, b)); }
float rtSourceValue(highp int x, highp int y, highp int gw, int srcCh, bool plane, highp int tile, bool fill) {
  highp int n = plane ? y * rtSize().x + x : tile + y * gw + x;
  vec4 v = rtFetch(n);
  float s = srcCh == 4 ? rtMapOf(v, n) : rtChannel(v, srcCh);
  return fill ? max(s, 0.0) : s;
}
// A node at level 0 from up to 4 × 4 source cells, in one pass (Welford,
// count-weighted): tree 0 mean, 1 variance, 2 min, 3 max.
float rtReduceSource(int tree, highp int nx, highp int ny, highp int gw, highp int gh, int cellLevel, int srcCh, bool plane, highp int tile, bool fill) {
  highp ivec2 s = rtSize();
  float total = 0.0;
  float mean = 0.0;
  float m2 = 0.0;
  float mn = 3.0e38;
  float mx = -3.0e38;
  for (int i = 0; i < 16; i++) {
    highp int x = nx * 4 + (i & 3);
    highp int y = ny * 4 + (i >> 2);
    if (x >= gw || y >= gh) continue;
    float w = rtCount(s.x, 1 << cellLevel, x) * rtCount(s.y, 1 << cellLevel, y);
    float v = rtSourceValue(x, y, gw, srcCh, plane, tile, fill);
    float sum = total + w;
    float d = v - mean;
    mean += d * w / sum;
    m2 += w * d * (v - mean);
    total = sum;
    mn = min(mn, v);
    mx = max(mx, v);
  }
  if (tree == 0) return mean;
  if (tree == 1) return m2 / total;
  return tree == 2 ? mn : mx;
}
// A node at level l ≥ 1 from up to 4 × 4 children of level l − 1 (Chan's
// merge of their means and variances, count-weighted). The children are
// channel ch plus, unless loCh is −1, their low halves in channel loCh.
float rtNodeValue(vec4 v, int ch, int loCh) { return rtChannel(v, ch) + (loCh < 0 ? 0.0 : rtChannel(v, loCh)); }
float rtReduceChildren(int l, int tree, highp int nx, highp int ny, highp int gw, highp int gh, int cellLevel, int ch, int loCh) {
  highp ivec2 s = rtSize();
  highp int cw = rtGridDiv(gw, l - 1);
  highp int chh = rtGridDiv(gh, l - 1);
  highp int block = (1 << (2 * l)) << cellLevel;
  highp int meanBase = rtTreeBase(gw, gh, l - 1, 0);
  highp int ownBase = rtTreeBase(gw, gh, l - 1, tree);
  float total = 0.0;
  float mean = 0.0;
  float m2 = 0.0;
  float mn = 3.0e38;
  float mx = -3.0e38;
  for (int i = 0; i < 16; i++) {
    highp int x = nx * 4 + (i & 3);
    highp int y = ny * 4 + (i >> 2);
    if (x >= cw || y >= chh) continue;
    float own = rtNodeValue(rtFetch(ownBase + y * cw + x), ch, loCh);
    if (tree >= 2) {
      mn = min(mn, own);
      mx = max(mx, own);
      continue;
    }
    float w = rtCount(s.x, block, x) * rtCount(s.y, block, y);
    float m = tree == 0 ? own : rtNodeValue(rtFetch(meanBase + y * cw + x), ch, loCh);
    float sum = total + w;
    float d = m - mean;
    mean += d * w / sum;
    m2 += w * own + w * d * (m - mean);
    total = sum;
  }
  if (tree == 0) return mean;
  if (tree == 1) return m2 / total;
  return tree == 2 ? mn : mx;
}
float rtReduceNode(int l, int tree, highp int nx, highp int ny, highp int gw, highp int gh, int cellLevel, int srcCh, bool plane, highp int tile, int ch, int loCh, bool fill) {
  if (l == 0) return rtReduceSource(tree, nx, ny, gw, gh, cellLevel, srcCh, plane, tile, fill);
  return rtReduceChildren(l, tree, nx, ny, gw, gh, cellLevel, ch, loCh);
}
// A level below the last at texel self: its node as a high half and, with a
// low channel, the low half (else old.y), or old where the level has no node.
vec2 rtStatsNode(vec2 old, highp int self, int l, highp int gw, highp int gh, int cellLevel, int srcCh, bool plane, highp int tile, int ch, int loCh, bool fill) {
  highp int base = rtTreeBase(gw, gh, l, 0);
  highp int size = rtGridDiv(gw, l) * rtGridDiv(gh, l);
  if (self < base || self >= base + 4 * size) return old;
  int tree = int((self - base) / size);
  highp int node = self - base - tree * size;
  highp int nw = rtGridDiv(gw, l);
  highp int ny = node / nw;
  float v = rtReduceNode(l, tree, node - ny * nw, ny, gw, gh, cellLevel, srcCh, plane, tile, ch, loCh, fill);
  float hi = rtHalf(v);
  return vec2(hi, loCh < 0 ? old.y : rtHalf(v - hi));
}
// The texel's value after a statistics level (self is its linear index), or
// the old value when the level doesn't write it. At the last level the node
// is the whole grid: statistics [first, first + count) go to the bank as
// hi/lo pairs, with the tag (the iteration that wrote it) at bank texel 16; the mask's
// max_f, min_f and avg go to texels 0-2.
float rtStatsLevel(float old, highp int self, int l, highp int gw, highp int gh, int cellLevel, int srcCh, bool plane, highp int tile, int ch, int loCh, bool fill, int bank, int lastFirst, int lastCount, bool lastIsMask, int tag) {
  int depth = rtStatsDepth(gw, gh);
  if (l >= depth) return old;
  if (l == depth - 1) {
    highp int q = self - bank;
    if (lastIsMask) {
      // max_f, min_f, avg (shmap.cc: min_f starts at 65535, max_f at 0).
      if (q < 0 || q > 2) return old;
      if (q == 0) return rtHalf(max(rtReduceNode(l, 3, 0, 0, gw, gh, cellLevel, srcCh, plane, tile, ch, loCh, fill), 0.0));
      if (q == 1) return rtHalf(min(rtReduceNode(l, 2, 0, 0, gw, gh, cellLevel, srcCh, plane, tile, ch, loCh, fill), ${H(65535 / 327.68)}));
      return rtHalf(rtReduceNode(l, 0, 0, 0, gw, gh, cellLevel, srcCh, plane, tile, ch, loCh, fill));
    }
    if (q == 16) return float(tag);
    if (q < 2 * lastFirst || q >= 2 * (lastFirst + lastCount)) return old;
    int k = int(q) / 2 - lastFirst;
    int tree = k & 3;
    float v = rtReduceNode(l, tree == 1 ? 1 : tree, 0, 0, gw, gh, cellLevel, srcCh, plane, tile, ch, loCh, fill);
    if (tree == 1) v = sqrt(max(v, 0.0));
    float hi = rtHalf(v);
    return (q & 1) == 0 ? hi : rtHalf(v - hi);
  }
  return rtStatsNode(vec2(old, 0.0), self, l, gw, gh, cellLevel, srcCh, plane, tile, ch, -1, fill).x;
}
`, kt = "\nint rtViewMet(bool finalIt) {\n  if (!finalIt) return 0;\n  int v = int(view);\n  return v == 1 ? 4 : v == 2 ? 1 : v == 3 ? 2 : v == 4 ? 3 : 0;\n}\nfloat rtProtection(float L0) {\n  if (rtProtect.w < 0.5) return 1.0;\n  float t = clamp((L0 - rtProtect.x) / rtProtect.y, 0.0, 1.0);\n  return 1.0 - rtProtect.z * t * t * (3.0 - 2.0 * t);\n}\n// Iteration it's output lightness (RawTherapee units) from its map lum, the\n// original lightness orig (units) and hue, and the copy the views keep in G.\nfloat rtOutput(int it, float lum, float orig, float hue, int space, float copy) {\n  bool finalIt = it == rtIterCount();\n  int viewmet = rtViewMet(finalIt);\n  float mean = rtBank(it, 4);\n  float std = rtBank(it, 5);\n  float mn = rtBank(it, 6);\n  float mx = rtBank(it, 7);\n  float varx = rtVarx(it);\n  float mini = mean - varx * std;\n  if (mini < mn) mini = mn + 0.1;\n  float maxi = mean + varx * std;\n  if (maxi > mx) maxi = mx - 0.1;\n  float delta = maxi - mini;\n  if (delta == 0.0) delta = 1.0;\n  float aza = std != 0.0 ? 16300.0 / (2.0 * std) : 0.0;\n  float azb = -aza * (mean - 2.0 * std);\n  float bzb = 16300.0 - aza * mean;\n  float m3 = mean - mini;\n  float n3 = mn - mini;\n  float x3 = mx - mini;\n  float l = lum - mini;\n  float gan = 0.5;\n  if (rtFlags[0].z > 0.5 && m3 != 0.0 && std != 0.0) gan = 2.0 * rtGain(rtAbsciss(l, m3, std, n3, x3));\n  float cd = gan * (32768.0 / delta) * l + rtFlags[1].z;\n  float str = rtStrengthx(it);\n  if (it == 1 && rtFlags[0].w > 0.5) {\n    float h = space == 0 ? rtHueOf(hue) : hue;\n    str *= 1.0 + 2.0 * (rtHueCurve(h) - 0.5);\n  }\n  str *= rtProtection(orig / 327.68);\n  if (viewmet == 0) return str * (clamp(cd, 0.0, max(32768.0, orig)) - orig) + orig;\n  if (viewmet == 1) return copy * 327.68;\n  if (viewmet == 4) return orig + str * (orig - copy * 327.68);\n  bool tranIsCopy = !rtHasTrans() || (it == 1 && rtFlags[2].x > 0.5);\n  float tran = tranIsCopy ? (rtHasTrans() ? copy : copy * 327.68) : lum;\n  if (viewmet == 2) return tran <= m3 ? azb + aza * tran : bzb + aza * tran;\n  return 1000.0 + tran * 700.0;\n}\n", At = "\n// A blur value: B, plus its low half in G where the pass keeps one.\nfloat rtBlurOf(vec4 v) { return v.b + (rtLo() ? v.g : 0.0); }\n// A blur value to store in B and G (G kept as it was without a low half).\nvec2 rtBlurPair(float v, float oldLo) {\n  float hi = rtHalf(v);\n  return vec2(hi, rtLo() ? rtHalf(v - hi) : oldLo);\n}\n// The source of the current iteration at a texel, L* units with eps: P1\n// converts the input, later iterations read G.\nfloat rtSrc(int it, ivec2 texel) {\n  __SRC__\n}\nfloat rtCellCount(int axis, int level, highp int c) {\n  highp ivec2 s = rtSize();\n  return rtCount(axis == 0 ? s.x : s.y, 1 << level, c);\n}\n// A reduction draw at texel self: the from-level cells under the cell, count-weighted.\nvec2 rtReduceTexel(vec2 old, highp int self, int from, int to) {\n  highp ivec2 s = rtSize();\n  highp int base = rtTileBase(to);\n  highp int cw = rtCells(s.x, to);\n  if (self < base || self >= base + rtTileSize(to)) return old;\n  highp int cell = self - base;\n  highp int cy = cell / cw;\n  highp int cx = cell - cy * cw;\n  int q = 1 << (to - from);\n  highp int fw = rtCells(s.x, from);\n  highp int fh = rtCells(s.y, from);\n  highp int fbase = rtTileBase(from);\n  float total = 0.0;\n  float acc = 0.0;\n  for (int i = 0; i < 16; i++) {\n    int dx = i & 3;\n    int dy = i >> 2;\n    if (dx >= q || dy >= q) continue;\n    highp int x = cx * q + dx;\n    highp int y = cy * q + dy;\n    if (x >= fw || y >= fh) continue;\n    float w = rtCellCount(0, from, x) * rtCellCount(1, from, y);\n    float v = rtBlurOf(rtFetch(from == 0 ? y * s.x + x : fbase + y * fw + x));\n    total += w;\n    acc += w * v;\n  }\n  return rtBlurPair(acc / total, old.y);\n}\n// A full-resolution box along an axis (boxblur.cc 505-745): the mean over the\n// window inside the frame.\nfloat rtBoxFull(ivec2 p, int axis, int r) {\n  highp ivec2 s = rtSize();\n  highp int n = axis == 0 ? s.x : s.y;\n  highp int at = axis == 0 ? p.x : p.y;\n  float acc = 0.0;\n  float count = 0.0;\n  for (int i = 0; i < 35; i++) {\n    if (i > 2 * r) break;\n    highp int q = at - r + i;\n    if (q < 0 || q >= n) continue;\n    acc += rtBlurOf(fetchPrev4(axis == 0 ? ivec2(q, p.y) : ivec2(p.x, q)));\n    count += 1.0;\n  }\n  return acc / count;\n}\n// The coarse box of the decimated chain: variance-matched fractional weights,\n// count-weighted, truncated at the frame.\nvec2 rtBoxCoarse(vec2 old, highp int self, int level, int axis, int r, float prefilter) {\n  highp ivec2 s = rtSize();\n  highp int size = rtTileSize(level);\n  highp int pBase = rtTileBase(level);\n  highp int qBase = pBase + size;\n  highp int dst = axis == 0 ? qBase : pBase;\n  highp int src = axis == 0 ? pBase : qBase;\n  if (self < dst || self >= dst + size) return old;\n  highp int cw = rtCells(s.x, level);\n  highp int chh = rtCells(s.y, level);\n  highp int cell = self - dst;\n  highp int cy = cell / cw;\n  highp int cx = cell - cy * cw;\n  float f = float(1 << level);\n  vec2 mt = rtFractional(float(r) * float(r + 1) / 3.0 / (f * f) - prefilter);\n  int m = int(mt.x);\n  highp int n = axis == 0 ? cw : chh;\n  highp int at = axis == 0 ? cx : cy;\n  float acc = 0.0;\n  float total = 0.0;\n  for (int i = 0; i < 67; i++) {\n    if (i > 2 * m + 2) break;\n    int d = i - m - 1;\n    highp int c = at + d;\n    if (c < 0 || c >= n) continue;\n    float w = (d == -m - 1 || d == m + 1 ? mt.y : 1.0) * rtCellCount(axis, level, c);\n    highp int t = axis == 0 ? src + cy * cw + c : src + c * cw + cx;\n    acc += w * rtBlurOf(rtFetch(t));\n    total += w;\n  }\n  return rtBlurPair(acc / total, old.y);\n}\nfloat rtPrefilter(int it, int j, int box) {\n  if (box != 0) return 0.0;\n  int to = rtLevel(it, j);\n  int from = j == 0 ? 0 : rtLevel(it, j - 1);\n  return to > from ? (1.0 - pow(4.0, float(from - to))) / 12.0 : 0.0;\n}\n// schedule.ts readbackCell: the lower cell pixel x of an axis of n pixels\n// reads between, and the upper one's weight, from the cells' true centres,\n// past the outer ones along the edge cells' slope.\nvec2 rtReadbackCell(highp int x, highp int n, int level) {\n  highp int count = rtCells(n, level);\n  if (count == 1) return vec2(0.0);\n  highp int c0 = clamp(int(floor((float(x) + 0.5) / float(1 << level) - 0.5)), 0, count - 2);\n  highp int c1 = c0 + 1;\n  float a = float(c0 << level) + (float(min(1 << level, n - (c0 << level))) - 1.0) * 0.5;\n  float b = float(c1 << level) + (float(min(1 << level, n - (c1 << level))) - 1.0) * 0.5;\n  return vec2(float(c0), (float(x) - a) / (b - a));\n}\n// The blur of chain position j at pixel p, L* units: the B plane at full\n// resolution, else the tile bilinearly.\nfloat rtBlurAt(int it, int j, ivec2 p) {\n  int level = rtLevel(it, j);\n  if (level == 0) return rtBlurOf(fetchPrev4(p));\n  highp ivec2 s = rtSize();\n  highp int cw = rtCells(s.x, level);\n  highp int chh = rtCells(s.y, level);\n  highp int base = rtTileBase(level);\n  vec2 cx = rtReadbackCell(p.x, s.x, level);\n  vec2 cy = rtReadbackCell(p.y, s.y, level);\n  ivec2 c0 = ivec2(int(cx.x), int(cy.x));\n  ivec2 c1 = min(c0 + 1, ivec2(cw - 1, chh - 1));\n  vec2 t = vec2(cx.y, cy.y);\n  float v00 = rtBlurOf(rtFetch(base + c0.y * cw + c0.x));\n  float v10 = rtBlurOf(rtFetch(base + c0.y * cw + c1.x));\n  float v01 = rtBlurOf(rtFetch(base + c1.y * cw + c0.x));\n  float v11 = rtBlurOf(rtFetch(base + c1.y * cw + c1.x));\n  return mix(mix(v00, v10, t.x), mix(v01, v11, t.x), t.y);\n}\n", jt = `
float rtRangeValue(int i, int size, float thresh2) {
  if (i >= size - 1) return 1e-15;
  float fi = float(i);
  return exp(-min(10.0, fi * fi / thresh2));
}
float rtRange(float d, bool truncated) {
  float thresh = 100.0 * rtMask[1].z;
  int size = int(float(int(thresh)) * ${H(Math.fround(Math.sqrt(10)))} + 1.0);
  float thresh2 = thresh * thresh;
  if (truncated) return rtRangeValue(clamp(int(d), 0, size - 1), size, thresh2);
  if (d > float(size - 2)) return 1e-15;
  int i = int(d);
  float a = rtRangeValue(i, size, thresh2);
  return a + (rtRangeValue(i + 1, size, thresh2) - a) * (d - float(i));
}
// One dirpyr_shmap level (shmap.cc 338-450, level < 2) at p, stride s, from
// channel ch (fill: max(v, 0) first, for level 0).
float rtDirpyr(ivec2 p, int scale, int ch, bool fill) {
  highp ivec2 sz = rtSize();
  int q = max(0, (sz.x - 2 * scale - 3 + 3) / 4);
  bool truncated = p.x >= scale && p.x < scale + 4 * q;
  float centre = rtChannel(fetchPrev4(p), ch);
  if (fill) centre = max(centre, 0.0);
  int r0 = max(p.y - scale, p.y - (p.y / scale) * scale);
  int c0 = p.x < scale ? p.x - (p.x / scale) * scale : p.x - scale;
  float val = 0.0;
  float norm = 0.0;
  for (int i = 0; i < 9; i++) {
    int y = r0 + (i / 3) * scale;
    int x = c0 + (i - (i / 3) * 3) * scale;
    if (y > min(p.y + scale, sz.y - 1) || x > min(p.x + scale, sz.x - 1)) continue;
    float v = rtChannel(fetchPrev4(ivec2(x, y)), ch);
    if (fill) v = max(v, 0.0);
    float w = rtRange(abs(v - centre) * 327.68, truncated);
    val += w * v;
    norm += w;
  }
  return val / norm;
}
// out after the map curve and the shadows/highlights factor, L* units.
float rtMasked(int it, int j, float out0, float map) {
  if (it != 1 || rtMapMet() == 0) return out0;
  float o = rtMask[0].y > 0.5 ? 0.5 * rtMapLut(2.0 * out0 * 327.68) / 327.68 : out0;
  if (!rtMaskAt(it, rtScales(it) - 1 - j)) return o;
  vec4 c = vec4(rtFetch(0).g, rtFetch(1).g, rtFetch(2).g, 0.0) * 327.68;
  float hTh = float(int(c.x - rtMask[0].w * (c.x - c.z) / 100.0));
  float sTh = float(int(rtMask[1].y * (c.z - c.y) / 100.0));
  float mapval = 1.0 + map * 327.68;
  float hW = (100.0 - rtMask[0].z) / 100.0;
  float sW = (100.0 - rtMask[1].x) / 100.0;
  float factor = 1.0;
  if (mapval > hTh) factor = (hTh + hW * (mapval - hTh)) / mapval;
  else if (mapval < sTh) factor = (sTh - sW * (sTh - mapval)) / mapval;
  return o * factor;
}
`, Mt = "\nfloat rtMasked(int it, int j, float out0, float map) { return out0; }\n", Nt = "\nfloat rtMapTexel(ivec2 t) { return rtMapOf(fetchPrev4(t), t.y * rtSize().x + t.x); }\n// median.h's 9-value network.\nfloat rtMedian9(float a0, float a1, float a2, float a3, float a4, float a5, float a6, float a7, float a8) {\n  float t = min(a1, a2); a2 = max(a1, a2); a1 = t;\n  t = min(a4, a5); a5 = max(a4, a5); a4 = t;\n  t = min(a7, a8); a8 = max(a7, a8); a7 = t;\n  t = min(a0, a1); a1 = max(a0, a1); a0 = t;\n  t = min(a3, a4); a4 = max(a3, a4); a3 = t;\n  t = min(a6, a7); a7 = max(a6, a7); a6 = t;\n  t = min(a1, a2); a2 = max(a1, a2); a1 = t;\n  t = min(a4, a5); a5 = max(a4, a5); a4 = t;\n  t = min(a7, a8); a8 = max(a7, a8);\n  a3 = max(a0, a3);\n  a5 = min(a5, a8);\n  a7 = max(a4, t);\n  t = min(a4, t);\n  a6 = max(a3, a6);\n  a4 = max(a1, t);\n  a2 = min(a2, a5);\n  a4 = min(a4, a7);\n  t = min(a4, a2);\n  a2 = max(a4, a2);\n  a4 = max(a6, t);\n  return min(a4, a2);\n}\n", Pt = `
  if (st.kind == ${U.reduce}) {
    ivec2 r = rtReduction(st.it, st.j, st.sub);
    if (r.y >= 0) c.bg = rtReduceTexel(c.bg, self, r.x, r.y);
  } else if (st.kind == ${U.box}) {
    int box = st.sub >> 1;
    int axis = st.sub & 1;
    int r = rtBoxRadius(rtIncrement(st.it, st.j), box);
    if (r >= 0) {
      int level = rtLevel(st.it, st.j);
      if (level == 0) c.bg = rtBlurPair(rtBoxFull(p, axis, r), c.g);
      else c.bg = rtBoxCoarse(c.bg, self, level, axis, r, rtPrefilter(st.it, st.j, box));
    }
  } else if (st.kind == ${U.accumulate}) {
    int level = rtLevel(st.it, st.j);
    float out0 = rtBlurAt(st.it, st.j, p);
    float map = level == 0 ? c.a : max(out0, 0.0);
    float used = rtMasked(st.it, st.j, out0, map);
    float src = rtSrc(st.it, p);
    float limit = rtLimit(st.it);
    float ilimit = rtLimitInv(st.it);
    float ratio = src / used;
    if (!(ratio > 0.0)) ratio = src > 0.0 && !(used > 0.0) ? limit : ilimit;
    ratio = clamp(ratio, ilimit, limit);
    bool shadowInA = level == 0 && rtMaskAt(st.it, rtScales(st.it) - 1 - st.j);
    float before = shadowInA ? c.r : rtMapOf(c, self);
    float now = before + rtPond(st.it) * (rtLogMode() ? log(ratio) : ratio);
    c.r = rtHalf(now);
    if (self >= 35) c.a = rtHalf(now - c.r);
    int v = int(__VIEW__);
    bool last = st.j == rtScales(st.it) - 1 && st.it == rtIterCount();
    if (last && (v == 1 || v == 2 || ((v == 3 || v == 4) && !rtHasTrans()))) c.g = rtHalf(used);
  } else if (st.kind == ${U.stats1} || st.kind == ${U.stats2}) {
    bool second = st.kind == ${U.stats2};
    int bank = (st.it & 1) * 17;
    highp int depth = rtStatsDepth(sz.x, sz.y);
    // The tree nodes' low halves go to G, unless G keeps the final iteration's copy.
    int lo = st.it == rtIterCount() && int(__VIEW__) != 0 ? -1 : 1;
    if (st.sub == depth - 1) {
      int first = second ? 4 : 0;
      int count = second || rtHasTrans() ? 4 : 8;
      c.a = rtStatsLevel(c.a, self, st.sub, sz.x, sz.y, 0, 4, true, 0, 2, lo, false, bank, first, count, false, second || !rtHasTrans() ? st.it : -1);
    } else {
      vec2 node = rtStatsNode(vec2(c.b, c.g), self, st.sub, sz.x, sz.y, 0, 4, true, 0, 2, lo, false);
      c.b = node.x;
      c.g = node.y;
    }
  } else if (st.kind == ${U.transmission}) {
    float mean = rtBank(st.it, 0);
    float std = rtBank(st.it, 1);
    if (rtHasTrans() && mean != 0.0 && std != 0.0) {
      float m = rtMapOf(c, self);
      float t = m * (-1.0 + 4.0 * rtTrans(rtAbsciss(m, mean, std, rtBank(st.it, 2), rtBank(st.it, 3))));
      c.r = rtHalf(t);
      if (self >= 35) c.a = rtHalf(t - c.r);
      int v = int(__VIEW__);
      if (rtMedianAt(st.it) && st.it == rtIterCount() && (v == 3 || v == 4)) c.g = rtHalf(t);
    }
  }`, Ft = `
  if (st.kind == ${U.start}) {
    vec2 src = rtBlurPair(rtSourceAt(p), 0.0);
    c = vec4(0.0, src.y, src.x, 0.0);
  } else if (st.kind == ${U.shmap1}) {
    if (rtLevel(st.it, st.j) == 0) c.a = rtHalf(rtDirpyr(p, 1, 2, true));
  } else if (st.kind == ${U.shmap2}) {
    if (rtLevel(st.it, st.j) == 0) c.a = rtHalf(rtDirpyr(p, 2, 3, false));
  } else if (st.kind == ${U.maskStats}) {
    int level = rtLevel(st.it, st.j);
    highp int gw = rtCells(sz.x, level);
    highp int gh = rtCells(sz.y, level);
    bool plane = level == 0;
    c.g = rtStatsLevel(c.g, self, st.sub, gw, gh, level, plane ? 3 : 2, plane, rtTileBase(level), 1, -1, true, 0, 0, 3, true, -1);
  } else if (st.kind == ${U.median}) {
    float mean = rtBank(st.it, 0);
    float std = rtBank(st.it, 1);
    if (rtHasTrans() && mean != 0.0 && std != 0.0 && p.x >= 1 && p.y >= 1 && p.x < sz.x - 1 && p.y < sz.y - 1) {
      float m = rtMedian9(rtMapOf(c, self), rtMapTexel(p + ivec2(0, -1)), rtMapTexel(p + ivec2(0, 1)), rtMapTexel(p + ivec2(1, 0)),
        rtMapTexel(p + ivec2(-1, 0)), rtMapTexel(p + ivec2(-1, -1)), rtMapTexel(p + ivec2(1, -1)),
        rtMapTexel(p + ivec2(-1, 1)), rtMapTexel(p + ivec2(1, 1)));
      c.r = rtHalf(m);
      if (self >= 35) c.a = rtHalf(m - c.r);
    }
  }`, It = `
  if (st.kind == ${U.start}) {
    RtPixel px = rtPixelAt(p);
    int space = int(rtConv[0].x + 0.5);
    float src = rtHalf((rtOutput(st.it - 1, rtMapOf(c, self), px.L, px.hue, space, c.g) + 2.0) / 327.68);
    float a = self < 35 ? c.a : 0.0;
    if (self == 34 && rtBankTag(st.it - 1) != float(st.it - 1)) a = ${H(ot)};
    c = vec4(0.0, src, src, a);
  }`, Lt = `
  if (st.kind == ${U.flag}) {
    if (self == 34) c.a = ${H(ot)};
  }`, Rt = `
float rtF2xyz(float v) { return v > ${H(6 / 29)} ? v * v * v : (116.0 * v - 16.0) / ${H(K)}; }
// Color::gamutLchonly (color.cc 2916-3008), highlight flag on: tested in Rec.2020.
vec2 rtGamut(float HH, vec2 sincos, float L, float C) {
  for (int i = 0; i < 512; i++) {
    float a = C * sincos.y;
    float b = C * sincos.x;
    float fy = L / 116.0 + 16.0 / 116.0;
    float fx = 0.002 * a + fy;
    float fz = fy - 0.005 * b;
    float x = 65535.0 * rtF2xyz(fx) * 0.9642;
    float z = 65535.0 * rtF2xyz(fz) * 0.8249;
    float y = L > 8.0 ? 65535.0 * fy * fy * fy : 65535.0 * L / ${H(K)};
    vec3 rgb = ${ut(lt)} * vec3(x, y, z);
    if (!(rgb.r < 0.0 || rgb.g < 0.0 || rgb.b < 0.0)) break;
    if (L < 0.1) L = 0.1;
    if (HH < -0.9 && HH > -1.55) {
      if (C > 160.0 && L < 5.0) L = 5.0;
      if (C > 140.0 && L < 3.5) L = 3.5;
      if (C > 120.0 && L < 2.0) L = 2.0;
      if (C > 105.0 && L < 1.0) L = 1.0;
      if (C > 90.0 && L < 0.7) L = 0.7;
      if (C > 50.0 && L < 0.5) L = 0.5;
      if (C > 20.0 && L < 0.4) L = 0.4;
    }
    C *= 0.96;
    if (C <= 3.0) L += 0.15;
  }
  return vec2(L, C);
}
float rtHue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 6.0;
  else if (t > 6.0) t -= 6.0;
  if (t < 1.0) return p + (q - p) * t;
  if (t < 3.0) return q;
  if (t < 4.0) return p + (q - p) * (4.0 - t);
  return p;
}
vec3 rtGammaOutRgb(vec3 rgb) {
  if (rtConv[0].z < 0.5) return rgb;
  return vec3(rtGammaLut(rgb.r, rtGammaOut[0], rtGammaOut[1]), rtGammaLut(rgb.g, rtGammaOut[0], rtGammaOut[1]), rtGammaLut(rgb.b, rtGammaOut[0], rtGammaOut[1]));
}
vec4 rtFinal(ivec2 p, vec4 c) {
  int iters = rtIterCount();
  if (!rtMarked() || iters < 1 || iters > 5 || rtFetch(34).a == ${H(ot)} || !rtFits()) return vec4(0.0);
  if (rtBankTag(iters) != float(iters)) return vec4(0.0);
  vec3 x = rtLinear(fetchInput(p));
  RtPixel px = rtAnalyse(rtApplyGammaIn(65535.0 * x));
  int space = int(rtConv[0].x + 0.5);
  float Lout = rtOutput(iters, rtMapOf(c, p.y * rtSize().x + p.x), px.L, px.hue, space, c.g);
  vec3 rgb;
  if (space == 0) {
    float chroma = sqrt(px.c0 * px.c0 + px.c1 * px.c1);
    float C = chroma / 327.68;
    vec2 sincos = chroma == 0.0 ? vec2(0.0, 1.0) : vec2(px.c1 / chroma, px.c0 / chroma);
    if (rtFlags[1].w > 0.5) C *= 1.0 + 2.0 * (rtHueCurve(rtHueOf(px.hue)) - 0.5);
    vec2 lc = rtGamut(px.hue, sincos, Lout / 327.68, C);
    float L = lc.x;
    float a = 327.68 * lc.y * sincos.y / 327.68;
    float b = 327.68 * lc.y * sincos.x / 327.68;
    float fy = L / 116.0 + 16.0 / 116.0;
    float fx = 0.002 * a + fy;
    float fz = fy - 0.005 * b;
    vec3 xyz = vec3(65535.0 * rtF2xyz(fx) * 0.9642, L > 8.0 ? 65535.0 * fy * fy * fy : 65535.0 * L / ${H(K)}, 65535.0 * rtF2xyz(fz) * 0.8249);
    rgb = ${ut(ct(st))} * xyz;
  } else {
    float h = px.c0;
    float s = px.c1;
    if (rtFlags[1].w > 0.5) s *= 1.0 + 2.0 * (rtHueCurve(h) - 0.5);
    float l = Lout / 32768.0;
    if (s == 0.0) rgb = vec3(65535.0 * l);
    else {
      float m2 = l <= 0.5 ? l * (1.0 + s) : l + s - l * s;
      float m1 = 2.0 * l - m2;
      rgb = 65535.0 * vec3(rtHue2rgb(m1, m2, h * 6.0 + 2.0), rtHue2rgb(m1, m2, h * 6.0), rtHue2rgb(m1, m2, h * 6.0 - 2.0));
    }
  }
  vec3 d = rtGammaOutRgb(rgb) / 65535.0 - x;
  if (any(isnan(d)) || any(isinf(d))) return vec4(0.0);
  return vec4(rtHalf(d.r), rtHalf(d.g), rtHalf(d.b), ${H(at)});
}
`;
function zt(e) {
	if (e === 3) return {
		helpers: `${_t}${vt[3]}${xt}${Et}${Dt}${Ot}${kt}${Rt}`,
		glsl: "\n  c = rtFinal(ivec2(gl_FragCoord.xy), c);\n",
		region: "return ivec4(0, 0, rtSize());"
	};
	let t = e === 1 ? "return rtSourceAt(texel);" : "return fetchPrev4(texel).g;";
	return {
		helpers: [
			_t,
			vt[e],
			yt,
			bt,
			xt,
			e === 1 ? wt : Tt,
			Dt,
			Ot,
			e === 2 ? kt : "",
			At.replace("__SRC__", t),
			e === 1 ? jt : Mt,
			e === 1 ? Nt : ""
		].join("\n"),
		glsl: `
  highp ivec2 sz = rtSize();
  ivec2 p = ivec2(gl_FragCoord.xy);
  highp int self = p.y * sz.x + p.x;
  RtStep st = rtStepAt(uPassIndex);
  ${Lt}${e === 1 ? Ft : It}${Pt.split("__VIEW__").join(e === 1 ? We : Ue)}
`,
		region: "return rtRegion();"
	};
}
function Bt(e) {
	return `
{
  vec4 rtResult = textureLod(${e}, srcUv, 0.0);
  if (abs(rtResult.a - (${H(at)})) < 0.5) {
    vec3 rtX = uApplyBaseCurve ? vec3(rtUnbaseInline(lin.r), rtUnbaseInline(lin.g), rtUnbaseInline(lin.b)) : lin;
    lin += uApplyBaseCurve ? baselineTone(rtX + rtResult.rgb) - baselineTone(rtX) : rtResult.rgb;
  }
}
`;
}
var Vt = `
float rtUnbaseInline(float y) {
  if (y >= 1.0) return y;
  if (y <= 0.0) return y * ${H(G / W)};
  float c = y * y;
  float a = ${H(dt)} - y * ${H(pt)};
  float b = ${H(ft)} - y * ${H(mt)};
  float k = ${H(W)} - y * ${H(ht)};
  for (int i = 0; i < 6; i++) {
    float p = ((a * c + b) * c + k) * c - y * ${H(G)};
    float dp = (3.0 * a * c + 2.0 * b) * c + k;
    c = clamp(c - p / dp, 0.0, 1.0);
  }
  return c;
}
`, Ht = 1024;
function Ut(e) {
	let t = 0;
	for (let n = 0; n < e.length; n++) t = (t << 5) - t + e.charCodeAt(n) | 0;
	return `u_${(t >>> 0).toString(36).slice(0, 4)}_stageResult`;
}
var Y = {
	on: "Enabled",
	advanced: "Advanced",
	median: "Transmission median filter",
	method: "Method",
	space: "Colour space",
	gamma: "Gamma",
	maskMethod: "Mask method",
	strength: "Strength",
	radius: "Radius",
	contrast: "Contrast",
	highlightThreshold: "Highlight threshold",
	protectFrom: "Protect from",
	protectSoftness: "Softness",
	protectAmount: "Protection",
	maskHighlights: "Highlights",
	maskHighlightsWidth: "Highlights tonal width",
	maskShadows: "Shadows",
	maskShadowsWidth: "Shadows tonal width",
	maskRadius: "Mask radius",
	gammaValue: "Free gamma",
	gammaSlope: "Free gamma slope",
	iterations: "Iterations",
	scaleGradient: "Gaussian gradient",
	transmissionGradient: "Transmission gradient",
	strengthGradient: "Strength gradient",
	scales: "Scale",
	threshold: "Threshold",
	offset: "Offset",
	lightnessCurve: "L=f(L)",
	lightnessCurveHsl: "L=f(L), HSL",
	maskCurve: "Mask L=f(L)",
	hueCurve: "Strength=f(H)",
	transmissionCurve: "Transmission map",
	gainCurve: "Gain transmission"
};
function Wt() {
	let e = [];
	for (let t of L) e.push({
		key: t,
		glslType: "bool",
		default: N[t],
		label: Y[t]
	});
	for (let t of I) e.push({
		key: t,
		glslType: "int",
		default: V(N, t),
		range: {
			min: 0,
			max: Ge[t].length - 1,
			step: 1
		},
		label: Y[t]
	});
	for (let t of Be) e.push({
		key: t,
		glslType: "float",
		default: N[t],
		range: { ...M[t] },
		label: Y[t]
	});
	for (let t of R) e.push({
		key: t,
		glslType: "vec4",
		length: qe(t),
		default: V(N, t),
		label: Y[t]
	});
	for (let t of He) e.push({
		key: t,
		glslType: "int",
		default: 0
	});
	return e;
}
var Gt = (e) => {
	let t = Re[e];
	return t === 1 ? {
		key: e,
		glslType: "vec4",
		default: [
			0,
			0,
			0,
			0
		]
	} : {
		key: e,
		glslType: "vec4",
		length: t,
		default: Array(4 * t).fill(0)
	};
}, Kt = (e) => ({
	key: e === 1 ? We : Ue,
	glslType: "int",
	default: 0
}), qt = {
	1: [
		"rtIt1",
		"rtMask",
		"rtConv",
		"rtGammaIn",
		"rtCd",
		"rtCdEnds",
		"rtMap",
		"rtMapEnds",
		"rtTransA",
		"rtTransB"
	],
	2: [
		"rtIters",
		"rtFlags",
		"rtProtect",
		"rtConv",
		"rtGammaIn",
		"rtTransA",
		"rtTransB",
		"rtGainA",
		"rtGainB",
		"rtHue"
	],
	3: [
		"rtIters",
		"rtFlags",
		"rtProtect",
		"rtConv",
		"rtGammaIn",
		"rtGammaOut",
		"rtGainA",
		"rtGainB",
		"rtHue"
	]
}, Jt = {
	1: "p1Draws",
	2: "p2Draws",
	3: "p3Draws"
};
function Yt(e) {
	let t = zt(e);
	return {
		channels: 4,
		glsl: t.glsl,
		helpers: t.helpers,
		region: t.region,
		iterations: {
			key: Jt[e],
			max: Ht
		},
		uniforms: [...qt[e].map(Gt), Kt(e)],
		...e === 1 ? { keep: !0 } : {}
	};
}
function Xt() {
	return {
		id: F,
		name: "Retinex",
		phase: "decode",
		priority: 55,
		reads: "current",
		glsl: Bt(Ut(F)),
		helpers: Vt,
		uniforms: Wt(),
		passes: [
			Yt(1),
			Yt(2),
			Yt(3)
		],
		dormantWhen: {
			p1Draws: 0,
			p2Draws: 0,
			p3Draws: 0
		},
		presetScope: "global"
	};
}
//#endregion
//#region src/view.ts
var X = "standard", Zt = 1, Z = /* @__PURE__ */ new Set();
function Qt() {
	if (X === "standard") return null;
	let e = ye.indexOf(X);
	return {
		[z(Ue)]: e,
		[z(We)]: Zt === 1 ? e : 0
	};
}
function Q(e) {
	if (e !== X) {
		X = e, E.develop.setViewValues(Qt());
		for (let e of Z) e();
	}
}
function $t(e) {
	e !== Zt && (Zt = e, X !== "standard" && E.develop.setViewValues(Qt()));
}
function en() {
	if (Zt = 1, X !== "standard") {
		X = "standard";
		for (let e of Z) e();
	}
}
function tn() {
	return T.useSyncExternalStore((e) => (Z.add(e), () => Z.delete(e)), () => X);
}
//#endregion
//#region src/Panel.tsx
var nn = "Retinex", rn = [
	{
		value: "low",
		label: "Low"
	},
	{
		value: "uniform",
		label: "Uniform"
	},
	{
		value: "high",
		label: "High"
	},
	{
		value: "highlight",
		label: "Highlight"
	},
	{
		value: "highlightsPlus",
		label: "Highlights+"
	}
], an = [
	{
		value: "lab",
		label: "L*a*b*"
	},
	{
		value: "hslLog",
		label: "HSL logarithmic"
	},
	{
		value: "hslLinear",
		label: "HSL linear"
	}
], on = [
	{
		value: "none",
		label: "None"
	},
	{
		value: "low",
		label: "Low"
	},
	{
		value: "middle",
		label: "Middle"
	},
	{
		value: "high",
		label: "High"
	},
	{
		value: "free",
		label: "Free"
	}
], sn = [
	{
		value: "none",
		label: "None"
	},
	{
		value: "gaussian",
		label: "Gaussian mask"
	},
	{
		value: "partial",
		label: "Sharp mask (partial)"
	},
	{
		value: "total",
		label: "Sharp mask (total)"
	}
], cn = [
	{
		value: "standard",
		label: "Standard"
	},
	{
		value: "unsharp",
		label: "Unsharp mask"
	},
	{
		value: "mask",
		label: "Mask"
	},
	{
		value: "transmissionAuto",
		label: "Transmission (auto)"
	},
	{
		value: "transmissionFixed",
		label: "Transmission (fixed)"
	}
], ln = [
	{
		value: String(e.linear),
		label: "Linear"
	},
	{
		value: String(e.spline),
		label: "Custom"
	},
	{
		value: String(e.parametric),
		label: "Parametric"
	},
	{
		value: String(e.nurbs),
		label: "Control cage"
	},
	{
		value: String(e.catmullRom),
		label: "Flexible"
	}
], un = [{
	value: String(t.linear),
	label: "Linear"
}, {
	value: String(t.controlPoints),
	label: "Control points"
}], dn = [
	"Highlights",
	"Lights",
	"Darks",
	"Shadows"
], fn = [
	"Shadows split",
	"Midtones split",
	"Highlights split"
], pn = {
	method: "Where Retinex acts most: Low on dark tones, Uniform evenly, High on bright tones. Highlight, for the magenta cast of highlights, also scales chroma by the Strength=f(H) curve; Highlights+ eases the effect off over the brightest tones.",
	space: "The lightness Retinex works on: L*a*b* lightness, or HSL lightness through a logarithmic or a linear map.",
	gamma: "Restores tones with a gamma applied before Retinex and undone after it. Free sets your own gamma and slope.",
	maskMethod: "Limits the effect by the photo's own tones, against halos: a blurred mask, or a sharp mask on the smaller scales (partial) or on every scale (total).",
	view: "Shows a step of the process in place of the result, to tune it: the unsharp mask, the mask, or the transmission map, scaled to its range (auto) or not (fixed). Only the live view shows it.",
	strength: "How much of the result is mixed into the photo.",
	radius: "The largest blur Retinex compares each pixel with. Larger radii take in more of the surroundings.",
	contrast: "Low values raise local contrast and saturation but can bring artifacts; high values give a softer result.",
	scales: "How many blur sizes Retinex combines, from the smallest to the radius.",
	threshold: "Limits how far a pixel may differ from its surroundings in each blur. Higher values allow stronger local changes.",
	iterations: "Runs Retinex again on its own result, up to five times. The gradients then change the radius, the transmission and the strength from one run to the next.",
	offset: "Moves the result's lightness up or down."
}, mn = [
	"iterations",
	"maskMethod",
	"lightnessCurve",
	"lightnessCurveHsl",
	"hueCurve",
	"transmissionCurve",
	"median"
];
function hn() {
	let { Slider: t } = E.components, { Button: n, Field: r, Section: i, SegmentedControl: a, Select: o, Stack: s, Toggle: c } = E.ui, l = E.develop.useParamScope(), u = B(l.getParams()), d = tn(), f = () => B(l.getParams()), p = (e, t) => l.setParams(et(e, t)), m = (e) => l.commit(`${nn}: ${e}`), g = (e) => {
		let n = M[e], r = /* @__PURE__ */ T.createElement(t, {
			label: Y[e],
			value: u[e],
			min: n.min,
			max: n.max,
			step: n.step,
			defaultValue: N[e],
			onChange: (t) => p({
				...f(),
				[e]: Math.min(Math.max(t, n.min), n.max)
			}, [e]),
			onCommit: () => m(Y[e].toLowerCase())
		});
		return pn[e] ? /* @__PURE__ */ T.createElement("div", {
			key: e,
			title: pn[e]
		}, r) : /* @__PURE__ */ T.createElement(T.Fragment, { key: e }, r);
	}, _ = (e, t) => /* @__PURE__ */ T.createElement(r, {
		key: e,
		label: Y[e]
	}, /* @__PURE__ */ T.createElement(o, {
		ariaLabel: Y[e],
		title: pn[e],
		value: u[e],
		options: t,
		onChange: (n) => {
			t.some((e) => e.value === n) && (p({
				...f(),
				[e]: n
			}, [e]), m(Y[e].toLowerCase()));
		}
	})), v = (t, n, i, a, c = !1) => {
		let l = u[t], d = l[0] ?? 0, g = Y[t];
		return /* @__PURE__ */ T.createElement(s, {
			key: t,
			gap: 4
		}, /* @__PURE__ */ T.createElement(r, { label: g }, /* @__PURE__ */ T.createElement(o, {
			ariaLabel: `${g} type`,
			value: String(d),
			options: n ? un : ln,
			onChange: (e) => {
				p({
					...f(),
					[t]: h(Number(e), n, a)
				}, [t]), m(g);
			}
		})), d === e.parametric && !n ? y(t) : d === 0 ? null : /* @__PURE__ */ T.createElement(k, {
			label: g,
			curve: l,
			flat: n,
			periodic: i,
			identity: a,
			hueBar: c,
			onChange: (e) => p({
				...f(),
				[t]: e
			}, [t]),
			onCommit: () => m(g),
			onReset: () => {
				p({
					...f(),
					[t]: N[t]
				}, [t]), m(g);
			}
		}));
	}, y = (e) => {
		let n = u[e], r = (t, n) => {
			let r = [...f()[e]];
			r[t] = n, p({
				...f(),
				[e]: r
			}, [e]);
		};
		return /* @__PURE__ */ T.createElement(s, { gap: 4 }, dn.map((i, a) => /* @__PURE__ */ T.createElement(t, {
			key: i,
			label: i,
			value: n[4 + a] ?? 0,
			min: -100,
			max: 100,
			step: 1,
			defaultValue: 0,
			onChange: (e) => r(4 + a, e),
			onCommit: () => m(`${Y[e]} ${i.toLowerCase()}`)
		})), fn.map((i, a) => /* @__PURE__ */ T.createElement(t, {
			key: i,
			label: i,
			value: Math.round((n[1 + a] ?? 0) * 100),
			min: 5,
			max: 95,
			step: 1,
			defaultValue: [
				25,
				50,
				75
			][a],
			onChange: (e) => {
				let t = [
					n[1],
					n[2],
					n[3]
				];
				t[a] = e / 100, t[0] < t[1] && t[1] < t[2] && r(1 + a, e / 100);
			},
			onCommit: () => m(`${Y[e]} ${i.toLowerCase()}`)
		})));
	}, b = u.advanced, x = d === "standard", S = d === "mask" || d === "unsharp", C = u.method === "highlight" || u.method === "highlightsPlus", w = (e) => /* @__PURE__ */ T.createElement("div", {
		key: e,
		"aria-disabled": u.iterations <= 1,
		style: u.iterations <= 1 ? {
			opacity: .45,
			pointerEvents: "none"
		} : void 0
	}, g(e));
	return /* @__PURE__ */ T.createElement(s, {
		gap: 6,
		style: { padding: 8 }
	}, /* @__PURE__ */ T.createElement(c, {
		checked: u.on,
		label: Y.on,
		onChange: (e) => {
			p({
				...f(),
				on: e
			}, ["on"]), m(e ? "on" : "off");
		}
	}), /* @__PURE__ */ T.createElement(a, {
		size: "sm",
		value: b ? "advanced" : "standard",
		options: [{
			value: "standard",
			label: "Standard"
		}, {
			value: "advanced",
			label: "Advanced"
		}],
		onChange: (e) => {
			let t = e === "advanced", n = t ? {
				...f(),
				advanced: !0
			} : {
				...f(),
				...gn(N, mn),
				advanced: !1
			};
			p(n, t ? ["advanced"] : ["advanced", ...mn]), t || Q("standard"), m(t ? "advanced" : "standard");
		}
	}), _("method", rn), _("space", an), g("strength"), g("radius"), g("contrast"), C ? g("highlightThreshold") : null, u.method === "highlightsPlus" ? /* @__PURE__ */ T.createElement(T.Fragment, null, g("protectFrom"), g("protectSoftness"), g("protectAmount")) : null, b ? /* @__PURE__ */ T.createElement(r, { label: "Process" }, /* @__PURE__ */ T.createElement(o, {
		ariaLabel: "Process",
		title: pn.view,
		value: d,
		options: cn,
		onChange: (e) => {
			let t = ye.find((t) => t === e);
			t && Q(t);
		}
	})) : null, b ? /* @__PURE__ */ T.createElement(i, { title: "Mask" }, /* @__PURE__ */ T.createElement(s, { gap: 6 }, _("maskMethod", sn), u.maskMethod === "none" ? null : /* @__PURE__ */ T.createElement(T.Fragment, null, v("maskCurve", !1, !1, 0), g("maskHighlights"), g("maskHighlightsWidth"), g("maskShadows"), g("maskShadowsWidth"), u.maskMethod === "gaussian" ? g("maskRadius") : null))) : null, /* @__PURE__ */ T.createElement(i, { title: "Settings" }, /* @__PURE__ */ T.createElement(s, { gap: 6 }, b ? /* @__PURE__ */ T.createElement(i, { title: "Equalizer" }, /* @__PURE__ */ T.createElement(s, { gap: 6 }, u.space === "lab" ? v("lightnessCurve", !1, !1, 0) : v("lightnessCurveHsl", !1, !1, 0), x ? v("hueCurve", !0, !0, .5, !0) : null, _("gamma", on), u.gamma === "free" ? /* @__PURE__ */ T.createElement(T.Fragment, null, g("gammaValue"), g("gammaSlope")) : null)) : null, b && !S ? /* @__PURE__ */ T.createElement(i, { title: "Tone mapping" }, /* @__PURE__ */ T.createElement(s, { gap: 6 }, g("iterations"), w("scaleGradient"), w("transmissionGradient"), w("strengthGradient"))) : null, /* @__PURE__ */ T.createElement(i, { title: "Transmission" }, /* @__PURE__ */ T.createElement(s, { gap: 6 }, b && !S ? v("transmissionCurve", !0, !1, 0) : null, g("scales"), S ? null : g("threshold"), b && !S ? /* @__PURE__ */ T.createElement(c, {
		checked: u.median,
		label: Y.median,
		onChange: (e) => {
			p({
				...f(),
				median: e
			}, ["median"]), m(Y.median.toLowerCase());
		}
	}) : null)), /* @__PURE__ */ T.createElement(i, { title: "Gain and offset" }, /* @__PURE__ */ T.createElement(s, { gap: 6 }, v("gainCurve", !0, !1, 0), x ? g("offset") : null)))), /* @__PURE__ */ T.createElement(n, {
		size: "sm",
		onClick: () => {
			let e = {
				...N,
				on: f().on,
				advanced: f().advanced
			};
			p(e, Object.keys(N).filter((e) => e !== "on" && e !== "advanced")), Q("standard"), m("reset");
		}
	}, "Reset"));
}
function gn(e, t) {
	let n = {};
	for (let r of t) n[r] = e[r];
	return n;
}
//#endregion
//#region src/index.tsx
var _n = `${ze}.panel`, $ = null;
function vn() {
	let e = E.stores.useDevelopStore.getState();
	e.setDynParams(rt()), Q("standard"), e.commitEdit(`${nn} reset`);
}
var yn = `${F}.`;
function bn(e, t) {
	for (let n in e) if (n.startsWith(yn) && e[n] !== t[n]) return !0;
	for (let n in t) if (n.startsWith(yn) && !(n in e)) return !0;
	return !1;
}
function xn(e) {
	D(e), e.registerProcessingStage(Xt()), e.registerPanel({
		id: _n,
		title: nn,
		component: hn,
		defaultDock: {
			module: "develop",
			direction: "right",
			width: 280
		},
		onReset: vn
	}), $?.(), $t(B(e.stores.useDevelopStore.getState().paramBag).iterations), $ = e.stores.useDevelopStore.subscribe((e, t) => {
		let n = e.photoId !== t.photoId;
		if (n && Q("standard"), e.paramBag === t.paramBag || !n && !bn(e.paramBag, t.paramBag)) return;
		$t(B(e.paramBag).iterations);
		let r = nt(e.paramBag);
		r && e.setDynParams(r);
	});
}
function Sn() {
	$?.(), $ = null, en();
}
//#endregion
export { _n as PANEL_ID, xn as activate, Sn as deactivate };

//# sourceMappingURL=index.js.map