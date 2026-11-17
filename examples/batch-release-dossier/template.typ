// Example docspawner template: a batch release dossier for a pharmaceutical batch.
// Data contract: the data comes from data.json.
// It uses the allowlisted packages (typst-packages/allowlist.typ): alchemist for the molecule,
// fletcher for the process flow, lilaq for the charts, tiaoma (Zint as WebAssembly) for the
// GS1 codes, and zero for number formatting. The quality calculations are done in Typst.

#import "@preview/alchemist:0.2.0": skeletize, single, double, branch, cycle, fragment
#import "@preview/fletcher:0.5.8" as fletcher: node, edge
#import "@preview/lilaq:0.6.0" as lq
#import "@preview/tiaoma:0.4.0"
#import "@preview/zero:0.7.1": num

#let data = json("data.json")

// --- Look -----------------------------------------------------------------------

#let ink = rgb("#1b2333")
#let accent = rgb("#0f4c81")
#let teal = rgb("#0e7490")
#let muted = rgb("#5b6472")
#let rule = rgb("#d5d9e0")
#let soft = rgb("#f3f5f8")
#let pass = rgb("#15803d")
#let fail = rgb("#b91c1c")

#set document(title: "Batch release dossier " + data.batch.number, author: data.company.name)
#set text(font: "Libertinus Serif", size: 9.5pt, fill: ink)
#set par(justify: true, leading: 0.6em)
#set heading(numbering: "1.")
#show heading.where(level: 1): it => {
  set text(13pt, weight: "bold", fill: accent)
  block(above: 1.6em, below: 0.9em, it)
}
#show heading.where(level: 2): it => {
  set text(10.5pt, weight: "bold", fill: ink)
  block(above: 1.2em, below: 0.6em, it)
}
#show table.cell.where(y: 0): set text(weight: "bold")
#set table(
  stroke: (x, y) => if y == 0 { (bottom: 0.8pt + accent) } else { (bottom: 0.4pt + rule) },
  inset: (x: 5pt, y: 4pt),
)

#set page(
  paper: "a4",
  margin: (x: 2cm, top: 2.2cm, bottom: 2.2cm),
  header: context {
    if counter(page).get().first() > 1 {
      set text(8pt, fill: muted)
      grid(
        columns: (1fr, auto),
        [#data.company.name · Batch release dossier · #data.product.name],
        [Batch #data.batch.number],
      )
      v(-4pt)
      line(length: 100%, stroke: 0.4pt + rule)
    }
  },
  footer: context {
    set text(7.5pt, fill: muted)
    grid(
      columns: (1fr, auto, 1fr),
      align: (left, center, right),
      [#data.document.number · version #data.document.version],
      [Example data · not a real batch],
      [Page #counter(page).display() of #counter(page).final().first()],
    )
  },
)

// --- Helpers ------------------------------------------------------------------

#let fmt(value, digits) = str(calc.round(value, digits: digits))

#let badge(ok, yes: [PASS], no: [FAIL]) = box(
  inset: (x: 4pt, y: 1.5pt),
  radius: 2pt,
  fill: if ok { pass } else { fail },
  text(7pt, weight: "bold", fill: white, if ok { yes } else { no }),
)

#let formula(parts) = {
  parts.map(((element, count)) => if count > 1 [#element#sub[#str(count)]] else [#element]).join()
}

#let mean(xs) = xs.sum() / xs.len()
#let sd(xs) = {
  let m = mean(xs)
  calc.sqrt(xs.map(x => calc.pow(x - m, 2)).sum() / (xs.len() - 1))
}

/// GS1 check digit (mod 10, weights 3 and 1 from the right), as used by GTIN and SSCC.
#let gs1-check-digit(body) = {
  let digits = body.clusters().rev().map(int)
  let total = digits.enumerate().map(((i, d)) => if calc.even(i) { 3 * d } else { d }).sum()
  calc.rem(10 - calc.rem(total, 10), 10)
}

/// Least-squares line through (x, y): returns (slope, intercept).
#let linear-fit(xs, ys) = {
  let mx = mean(xs)
  let my = mean(ys)
  let sxy = xs.zip(ys).map(((x, y)) => (x - mx) * (y - my)).sum()
  let sxx = xs.map(x => calc.pow(x - mx, 2)).sum()
  let slope = sxy / sxx
  (slope, my - slope * mx)
}

#let card(title, body, fill: soft) = block(
  width: 100%,
  inset: 9pt,
  radius: 4pt,
  fill: fill,
  [#text(8pt, fill: muted, upper(title)) \ #body],
)

// --- Derived values -------------------------------------------------------------

#let gtin = data.gs1.gtinBody + str(gs1-check-digit(data.gs1.gtinBody))
#let sscc = data.gs1.ssccBody + str(gs1-check-digit(data.gs1.ssccBody))
#let unit-code(serial) = (
  "[01]" + gtin + "[17]" + data.batch.expiryGs1 + "[10]" + data.batch.number + "[21]" + serial
)

#let test-ok(t) = (t.min == none or t.result >= t.min) and (t.max == none or t.result <= t.max)
#let test-spec(t) = {
  if t.min != none and t.max != none [#t.min – #t.max #t.unit]
  else if t.max != none [≤ #t.max #t.unit]
  else [≥ #t.min #t.unit]
}

// Content uniformity, Ph. Eur. 2.9.40: AV = |M − X̄| + k·s, with M the reference value.
#let cu = data.uniformity
#let cu-mean = mean(cu.units)
#let cu-sd = sd(cu.units)
#let cu-m = calc.max(98.5, calc.min(101.5, cu-mean))
#let cu-av = calc.abs(cu-m - cu-mean) + cu.k * cu-sd
#let cu-ok = cu-av <= cu.l1

// Dissolution: mean and SD per time point, and the f2 similarity factor against the reference.
#let dis = data.dissolution
#let dis-mean = dis.test.map(mean)
#let dis-sd = dis.test.map(sd)
#let f2 = {
  let n = dis.times.len()
  let ssq = dis.reference.zip(dis-mean).map(((r, t)) => calc.pow(r - t, 2)).sum()
  50 * calc.log(100 / calc.sqrt(1 + ssq / n), base: 10)
}
#let q-index = dis.times.position(t => t == dis.q.minutes)
#let q-min = calc.min(..dis.test.at(q-index))
#let dis-ok = q-min >= dis.q.percent + 5 and f2 >= 50

// Stability: least-squares line per condition, and the time at which the long-term line reaches the limit.
#let st = data.stability
#let fits = st.conditions.map(c => linear-fit(c.months, c.assay))
#let (lt-slope, lt-intercept) = fits.first()
#let lt-months-to-limit = (st.limit - lt-intercept) / lt-slope

#let release-ok = (
  data.tests.all(test-ok) and data.ipc.all(i => i.conforms) and cu-ok and dis-ok
)

// --- Cover ----------------------------------------------------------------------

#grid(
  columns: (1fr, auto),
  align: (left + top, right + top),
  [
    #text(12pt, weight: "bold", data.company.name) \
    #text(fill: muted)[#data.company.site · #data.company.address]
  ],
  text(fill: muted, size: 8.5pt)[Document #data.document.number \ Version #data.document.version · #data.document.issued],
)

#v(1.6cm)
#text(10pt, fill: teal, weight: "bold", tracking: 1.5pt)[BATCH RELEASE DOSSIER]
#v(-0.2em)
#text(26pt, weight: "bold", fill: accent)[#data.product.name]
#v(-0.4em)
#text(14pt, fill: muted)[Batch #data.batch.number]

#v(1cm)
#grid(
  columns: (1fr, 1fr, 1fr),
  column-gutter: 8pt,
  row-gutter: 8pt,
  card("Active substance", [#data.product.substance (#formula(data.product.formula))]),
  card("Strength · form", [#data.product.strength · #data.product.form]),
  card("Batch size", [#data.batch.size \ #data.batch.packs]),
  card("Manufactured", data.batch.manufactured),
  card("Expiry", data.batch.expiry),
  card("Pharmacopoeia", data.product.pharmacopoeia),
)

#v(0.9cm)
#grid(
  columns: (auto, auto, 1fr),
  column-gutter: 20pt,
  align: horizon,
  [
    #tiaoma.data-matrix(unit-code(data.gs1.serials.first()), options: (input-mode: "gs1"), width: 2.6cm)
    #v(-0.3em)
    #text(7pt, fill: muted)[GS1 DataMatrix · first pack]
  ],
  [
    #tiaoma.qrcode(data.batch.verificationUrl, width: 2.6cm)
    #v(-0.3em)
    #text(7pt, fill: muted)[Verification link]
  ],
  block(
    width: 100%,
    inset: 12pt,
    radius: 4pt,
    fill: if release-ok { rgb("#f0fdf4") } else { rgb("#fef2f2") },
    stroke: 0.8pt + if release-ok { pass } else { fail },
    [
      #text(8pt, fill: muted)[QUALIFIED PERSON DECISION] \
      #text(16pt, weight: "bold", fill: if release-ok { pass } else { fail })[
        #if release-ok [Released] else [Not released]
      ] \
      #text(8.5pt)[Every release test, in-process control, content uniformity and dissolution criterion in this dossier is met.]
    ],
  ),
)

#v(1fr)
#text(8pt, fill: muted)[
  Unit code: #raw("(01) " + gtin + " (17) " + data.batch.expiryGs1 + " (10) " + data.batch.number + " (21) " + data.gs1.serials.first()) \
  GTIN check digit #str(gs1-check-digit(data.gs1.gtinBody)) computed in the template from the GS1 mod-10 rule.
]

#pagebreak()
#outline(title: [Contents], indent: 1.2em, depth: 2)

= Product and active substance

#grid(
  columns: (1fr, auto),
  column-gutter: 16pt,
  align: horizon,
  [
    #table(
      columns: (auto, 1fr),
      table.header([Property], [Value]),
      [Substance], data.product.substance,
      [Molecular formula], formula(data.product.formula),
      [Molar mass], [#data.product.molarMass g/mol],
      [CAS number], data.product.cas,
      [Dosage form], data.product.form,
      [Strength], data.product.strength,
    )
  ],
  figure(
    skeletize({
      single(absolute: -30deg)
      branch({ single(absolute: -90deg) })
      single(absolute: 30deg)
      single(absolute: -30deg)
      // Para-substituted benzene ring: the acid chain branches off after the third bond.
      cycle(6, {
        double()
        single()
        double()
        branch({
          single(absolute: -30deg)
          branch({ single(absolute: -90deg) })
          single(absolute: 30deg)
          branch({
            double(absolute: 90deg)
            fragment("O")
          })
          single(absolute: -30deg)
          fragment("OH")
        })
        single()
        double()
        single()
      })
    }),
    caption: [Skeletal formula of ibuprofen, drawn by alchemist.],
  ),
)

= Manufacturing process

The batch follows the validated wet-granulation process. Each arrow is a transfer between steps. Steps with an in-process control (IPC) are marked; their results are in the table below.

#let ipc-steps = data.ipc.map(i => i.step)
#align(center, fletcher.diagram(
  spacing: (10mm, 9mm),
  node-stroke: 0.7pt + accent,
  node-fill: soft,
  node-corner-radius: 3pt,
  edge-stroke: 0.7pt + ink,
  ..data.process.enumerate().map(((i, step)) => {
    let col = calc.rem(i, 4)
    let row = calc.quo(i, 4)
    let x = if calc.even(row) { col } else { 3 - col }
    let has-ipc = step.name in ipc-steps
    node(
      (x, row),
      [#text(8.5pt, weight: "bold", step.name) \ #text(7pt, fill: muted, step.equipment)],
      name: label(step.id),
      stroke: if has-ipc { 1.2pt + teal } else { 0.7pt + accent },
      width: 33mm,
    )
  }),
  ..data.process.windows(2).map(((a, b)) => edge(label(a.id), label(b.id), "-|>")),
))

#align(center, text(7.5pt, fill: muted)[A teal border marks a step with an in-process control.])

== In-process controls

#table(
  columns: (1.2fr, 1.3fr, 1fr, 1fr, auto),
  table.header([Step], [Control], [Specification], [Result], [Status]),
  ..data.ipc.map(i => (i.step, i.test, i.spec, i.result, badge(i.conforms))).flatten(),
)

= Release testing

The status column is computed in the template: each result is compared with its specification limits.

#table(
  columns: (1.5fr, 1.2fr, 1fr, 0.8fr, auto),
  align: (left, left, left, right, center),
  table.header([Test], [Method], [Specification], [Result], [Status]),
  ..data
    .tests
    .map(t => (t.name, text(fill: muted, t.method), test-spec(t), [#fmt(t.result, t.decimals) #t.unit], badge(test-ok(t))))
    .flatten(),
)

== Content uniformity

Ten units were assayed individually. The acceptance value follows Ph. Eur. 2.9.40: #box($"AV" = |M - overline(X)| + k s$), with $k = #cu.k$ for ten units and the reference value $M$ clamped to 98.5–101.5 %.

#grid(
  columns: (1.15fr, 1fr),
  column-gutter: 14pt,
  align: horizon,
  lq.diagram(
    width: 8.2cm,
    height: 4.6cm,
    xlabel: [Unit],
    ylabel: [% of label claim],
    ylim: (94, 106),
    legend: (position: bottom + right),
    lq.hlines(cu-mean, stroke: (paint: teal, dash: "dashed"), label: [mean]),
    lq.fill-between((0.5, 10.5), (98.5, 98.5), y2: (101.5, 101.5), fill: teal.transparentize(88%), label: [M range]),
    lq.stem(range(1, 11), cu.units, base: cu-mean, base-stroke: none, color: accent),
  ),
  table(
    columns: (1fr, auto),
    table.header([Quantity], [Value]),
    [Mean $overline(X)$], [#fmt(cu-mean, 2) %],
    [Standard deviation $s$], [#fmt(cu-sd, 2) %],
    [Reference value $M$], [#fmt(cu-m, 2) %],
    [Acceptance value AV], [*#fmt(cu-av, 2)*],
    [Limit L1], [≤ #cu.l1],
    [Status], badge(cu-ok),
  ),
)

== Dissolution

#dis.medium. Twelve vessels were tested at each time point. The profile is compared with the reference product by the similarity factor $f_2 = 50 log_10 (100 \/ sqrt(1 + 1/n sum (R_t - T_t)^2))$; $f_2 >= 50$ means similar.

#grid(
  columns: (1.15fr, 1fr),
  column-gutter: 14pt,
  align: horizon,
  lq.diagram(
    width: 8.2cm,
    height: 4.8cm,
    xlabel: [Time (min)],
    ylabel: [Dissolved (%)],
    ylim: (0, 105),
    legend: (position: bottom + right),
    lq.plot(dis.times, dis.reference, label: [Reference], mark: "s", color: muted, stroke: (dash: "dashed")),
    lq.plot(dis.times, dis-mean, yerr: dis-sd, label: [Batch (mean ± SD)], mark: "o", color: accent),
    lq.hlines(dis.q.percent + 5, stroke: (paint: fail, dash: "dotted"), label: [Q + 5 %]),
  ),
  [
    #table(
      columns: (auto, 1fr, 1fr),
      align: (right, right, right),
      table.header([min], [Batch], [Reference]),
      ..dis.times.zip(dis-mean, dis-sd, dis.reference).map(((t, m, s, r)) => (
        str(t),
        num(fmt(m, 1) + "+-" + fmt(s, 1)),
        fmt(r, 1),
      )).flatten(),
    )
    #v(4pt)
    $f_2 = #fmt(f2, 1)$ · lowest unit at #dis.q.minutes min: #fmt(q-min, 1) % #h(4pt) #badge(dis-ok)
  ],
)

#pagebreak()
= Stability

Assay over time at the three ICH storage conditions. Lines are least-squares fits computed in the template. The long-term line reaches the #st.limit % limit after about #fmt(lt-months-to-limit, 0) months. This is a simplified estimate: a shelf life under ICH Q1E uses the 95 % confidence bound of the regression, not the line itself.

#let palette = (accent, teal, rgb("#c2410c"))
#align(center, lq.diagram(
  width: 14cm,
  height: 6cm,
  xlabel: [Months],
  ylabel: [Assay (% of label claim)],
  xlim: (-1, 36),
  ylim: (93, 101.5),
  legend: (position: bottom + left),
  lq.hlines(st.limit, stroke: (paint: fail, dash: "dashed"), label: [Limit #st.limit %]),
  ..st
    .conditions
    .zip(fits, palette)
    .map(((c, fit, color)) => {
      let (slope, intercept) = fit
      (
        lq.plot(c.months, c.assay, mark: "o", stroke: none, color: color, label: [#c.kind · #c.name]),
        lq.plot((0, 36), (intercept, intercept + slope * 36), mark: none, color: color, stroke: (dash: "dashed", thickness: 0.6pt)),
      )
    })
    .flatten(),
))

#table(
  columns: (1.4fr, 1fr, 1fr, 1fr),
  align: (left, right, right, right),
  table.header([Condition], [Slope (% / month)], [Intercept (%)], [Last result (%)]),
  ..st.conditions.zip(fits).map(((c, fit)) => (
    [#c.kind · #c.name],
    fmt(fit.first(), 3),
    fmt(fit.last(), 2),
    [#fmt(c.assay.last(), 1) at #c.months.last() months],
  )).flatten(),
)

== Impurity trend

#let imp = data.impurities
#let imp-mesh = lq.colormesh(
  range(imp.months.len()),
  range(imp.names.len()),
  imp.values,
  map: color.map.flare.rev(),
  min: 0,
  max: 0.12,
)
#grid(
  columns: (1fr, auto),
  column-gutter: 8pt,
  align: horizon,
  lq.diagram(
    width: 12cm,
    height: 4.4cm,
    xlabel: [Months at 25 °C / 60 % RH],
    xaxis: (ticks: imp.months.enumerate().map(((i, m)) => (i, [#m]))),
    yaxis: (ticks: imp.names.enumerate().map(((i, n)) => (i, text(7.5pt, n)))),
    imp-mesh,
  ),
  lq.colorbar(imp-mesh, label: [%]),
)
#let imp-over = imp.names.zip(imp.values, imp.limits).filter(((n, vs, l)) => calc.max(..vs) > l)
#if imp-over.len() == 0 [
  #badge(true) Every impurity stays below its limit at every time point. Limits: #imp.names.zip(imp.limits).map(((n, l)) => [#n #l %]).join[, ].
] else [
  #badge(false) Above the limit: #imp-over.map(((n, vs, l)) => [#n (max #calc.max(..vs) %, limit #l %)]).join[, ].
]

= Serialization

Each pack carries a GS1 DataMatrix with its GTIN, expiry, batch and a unique serial number. The shipping case carries an SSCC as a GS1-128 barcode. Check digits are computed in the template; the codes are produced by Zint, compiled to WebAssembly, inside Typst.

#grid(
  columns: (1fr,) * 3,
  column-gutter: 10pt,
  row-gutter: 12pt,
  ..data.gs1.serials.map(s => block(
    width: 100%,
    inset: 7pt,
    radius: 3pt,
    stroke: 0.5pt + rule,
    grid(
      columns: (auto, 1fr),
      column-gutter: 7pt,
      align: horizon,
      tiaoma.data-matrix(unit-code(s), options: (input-mode: "gs1"), width: 1.5cm),
      text(7pt, font: "DejaVu Sans Mono")[GTIN #gtin \ EXP #data.batch.expiryGs1 \ LOT #data.batch.number \ SN #s],
    ),
  )),
)

#v(6pt)
#align(center, stack(
  spacing: 5pt,
  tiaoma.gs1-128("[00]" + sscc, width: 11cm, height: 1.6cm),
  text(7.5pt, fill: muted)[Shipping case · SSCC (00) #sscc · check digit #str(gs1-check-digit(data.gs1.ssccBody)) computed in the template],
))

= Certification

#block(
  width: 100%,
  inset: 10pt,
  radius: 4pt,
  fill: if release-ok { rgb("#f0fdf4") } else { rgb("#fef2f2") },
  stroke: 0.8pt + if release-ok { pass } else { fail },
  [
    #badge(release-ok, yes: [RELEASED], no: [NOT RELEASED]) #h(6pt)
    I certify that batch #data.batch.number was manufactured and checked in compliance with the marketing authorisation and good manufacturing practice, and that it meets every specification in this dossier.
  ],
)

#v(10pt)
#grid(
  columns: (1fr,) * data.approvals.len(),
  column-gutter: 14pt,
  ..data.approvals.map(a => [
    #v(20pt)
    #line(length: 100%, stroke: 0.5pt + muted)
    #strong(a.name) \
    #text(fill: muted, size: 8.5pt)[#a.role · #a.date]
  ]),
)

== Audit trail

#table(
  columns: (auto, auto, 1fr),
  table.header([Time], [User], [Action]),
  ..data.auditTrail.map(e => (e.time, raw(e.user), e.action)).flatten(),
)
