// Example docspawner template: a Certificate of Analysis for a pharmaceutical batch.
// Data contract: the data comes from data.json.
// It uses the allowlisted packages: alchemist (molecule), lilaq (chromatogram, dissolution)
// and tiaoma (GS1 DataMatrix, QR code). The chromatogram is computed from the peak table.

#import "@preview/alchemist:0.2.0": skeletize, single, double, branch, cycle, fragment
#import "@preview/lilaq:0.6.0" as lq
#import "@preview/tiaoma:0.4.0"

#let data = json("data.json")

#let ink = rgb("#1f2937")
#let accent = rgb("#0f4c81")
#let teal = rgb("#0e7490")
#let muted = rgb("#6b7280")
#let line-color = rgb("#d1d5db")
#let soft = rgb("#f3f5f8")
#let pass = rgb("#15803d")
#let fail = rgb("#b91c1c")

#set document(title: "Certificate of Analysis " + data.document.number, author: data.company.name)
#set text(font: "Libertinus Serif", size: 9pt, fill: ink)
#set page(
  paper: "a4",
  margin: (x: 1.8cm, top: 1.6cm, bottom: 2cm),
  footer: context {
    set text(7.5pt, fill: muted)
    grid(
      columns: (1fr, auto),
      [#data.company.name · #data.document.number · version #data.document.version · example data],
      [Page #counter(page).display() of #counter(page).final().first()],
    )
  },
)
#set table(
  stroke: (x, y) => if y == 0 { (bottom: 1pt + accent) } else { (bottom: 0.4pt + line-color) },
  inset: (x: 5pt, y: 4pt),
)
#show table.cell.where(y: 0): set text(weight: "bold")

// --- Helpers --------------------------------------------------------------------

#let fmt(value, digits) = str(calc.round(value, digits: digits))
#let mean(xs) = xs.sum() / xs.len()
#let sd(xs) = {
  let m = mean(xs)
  calc.sqrt(xs.map(x => calc.pow(x - m, 2)).sum() / (xs.len() - 1))
}
#let formula(parts) = {
  parts.map(((element, count)) => if count > 1 [#element#sub[#str(count)]] else [#element]).join()
}
#let section(title) = block(above: 1.3em, below: 0.6em, text(9pt, weight: "bold", fill: accent, upper(title)))
#let badge(ok) = box(
  inset: (x: 5pt, y: 2pt),
  radius: 2pt,
  fill: if ok { pass } else { fail },
  text(7pt, weight: "bold", fill: white, if ok [PASS] else [FAIL]),
)
#let key-values(..pairs) = table(
  columns: (auto, 1fr),
  column-gutter: 10pt,
  stroke: none,
  inset: (x: 0pt, y: 2.5pt),
  ..pairs.pos().map(((k, v)) => (text(fill: muted, k), v)).flatten(),
)

/// GS1 check digit (mod 10, weights 3 and 1 from the right).
#let gs1-check-digit(body) = {
  let digits = body.clusters().rev().map(int)
  let total = digits.enumerate().map(((i, d)) => if calc.even(i) { 3 * d } else { d }).sum()
  calc.rem(10 - calc.rem(total, 10), 10)
}

// --- Derived values -------------------------------------------------------------

#let gtin = data.gs1.gtinBody + str(gs1-check-digit(data.gs1.gtinBody))
#let pack-code = "[01]" + gtin + "[17]" + data.gs1.expiryGs1 + "[10]" + data.batch.number

#let assay = data.assay
#let assay-mean = mean(assay.replicates)
#let assay-rsd = sd(assay.replicates) / assay-mean * 100
#let assay-ok = (
  assay-mean >= assay.limits.first() and assay-mean <= assay.limits.last() and assay-rsd <= assay.maxRsd
)

// Chromatogram: the sum of one Gaussian per peak, sampled every 0.02 min.
#let chrom = data.chromatogram
#let chrom-t = range(0, chrom.runMinutes * 50 + 1).map(i => i / 50)
#let signal(t) = chrom.peaks.map(p => p.height * calc.exp(-calc.pow((t - p.rt) / p.width, 2) / 2)).sum()
#let chrom-y = chrom-t.map(signal)
#let impurities = chrom.peaks.filter(p => p.limitPercent != none)
#let impurity-ok(p) = p.areaPercent <= p.limitPercent
#let total-impurities = impurities.map(p => p.areaPercent).sum()

#let dis = data.dissolution
#let dis-means = dis.vessels.map(mean)
#let q-index = dis.vesselTimes.position(t => t == dis.limit.minutes)
#let q-min = calc.min(..dis.vessels.at(q-index))
#let dis-ok = q-min >= dis.limit.percent + 5

#let all-pass = data.tests.all(t => t.conforms) and assay-ok and impurities.all(impurity-ok) and dis-ok

// --- Page 1 ---------------------------------------------------------------------

#grid(
  columns: (1fr, auto, auto),
  column-gutter: 12pt,
  align: (left + bottom, center + bottom, center + bottom),
  [
    #text(13pt, weight: "bold", data.company.name) \
    #text(fill: muted)[#data.company.site · #data.company.address] \
    #v(4pt)
    #text(17pt, weight: "bold", fill: accent)[Certificate of Analysis] \
    #text(fill: muted)[No. #data.document.number · issued #data.document.issued]
  ],
  [
    #tiaoma.data-matrix(pack-code, options: (input-mode: "gs1"), width: 1.9cm)
    #text(6.5pt, fill: muted)[GS1 · pack]
  ],
  [
    #tiaoma.qrcode(data.document.verificationUrl, width: 1.9cm)
    #text(6.5pt, fill: muted)[Verify online]
  ],
)
#line(length: 100%, stroke: 1pt + accent)

#grid(
  columns: (1fr, 1fr, auto),
  column-gutter: 14pt,
  [
    #section[Product]
    #key-values(
      ([Product], strong(data.product.name)),
      ([Substance], data.product.substance),
      ([Formula], formula(data.product.formula)),
      ([Molar mass], [#data.product.molecularWeight g/mol]),
      ([CAS number], data.product.casNumber),
      ([GTIN], raw(gtin)),
    )
  ],
  [
    #section[Batch]
    #key-values(
      ([Batch], strong(data.batch.number)),
      ([Size], data.batch.size),
      ([Manufactured], data.batch.manufactured),
      ([Expiry], data.batch.expiry),
      ([Storage], data.batch.storage),
    )
  ],
  [
    #section[Structure]
    #block(stroke: 0.5pt + line-color, radius: 3pt, inset: 8pt, skeletize({
      fragment("HO")
      single(absolute: -30deg)
      // Para-substituted ring: the amide branches off after the third bond.
      cycle(6, {
        double()
        single()
        double()
        branch({
          single(absolute: -30deg)
          fragment("NH")
          single(absolute: 30deg)
          branch({
            double(absolute: 90deg)
            fragment("O")
          })
          single(absolute: -30deg)
        })
        single()
        double()
        single()
      })
    }))
  ],
)

#section[Test results]
#table(
  columns: (1.4fr, 1fr, 1.4fr, 0.9fr, auto),
  align: (left, left, left, left, center),
  table.header([Test], [Method], [Specification], [Result], [Status]),
  ..data.tests.map(t => (t.name, text(fill: muted, t.method), t.specification, strong(t.result), badge(t.conforms))).flatten(),
)

#section[Assay replicates]
#grid(
  columns: (1fr, 1fr, 1fr, 1fr, 1fr),
  column-gutter: 8pt,
  ..assay.replicates.enumerate().map(((i, r)) => block(
    width: 100%,
    inset: 7pt,
    radius: 3pt,
    fill: soft,
    [#text(7pt, fill: muted)[REPLICATE #(i + 1)] \ #text(12pt, weight: "bold")[#fmt(r, 1) %]],
  )),
  block(width: 100%, inset: 7pt, radius: 3pt, fill: soft, [
    #text(7pt, fill: muted)[MEAN · RSD] \ #text(12pt, weight: "bold")[#fmt(assay-mean, 2) %] #h(3pt) #text(8pt)[RSD #fmt(assay-rsd, 2) %]
  ]),
  block(width: 100%, inset: 7pt, radius: 3pt, fill: soft, [
    #text(7pt, fill: muted)[LIMITS] \ #assay.limits.first()–#assay.limits.last() %, RSD ≤ #assay.maxRsd % #h(3pt) #badge(assay-ok)
  ]),
)

#pagebreak()

// --- Page 2 ---------------------------------------------------------------------

#section[Related substances · HPLC chromatogram]
#text(fill: muted)[#chrom.method. The trace is drawn from the peak table below.]
#v(4pt)
#align(center, lq.diagram(
  width: 16.5cm,
  height: 5.2cm,
  xlabel: [Retention time (min)],
  ylabel: [Response (mAU)],
  ylim: (-0.1, 1.6),
  xlim: (0, chrom.runMinutes),
  lq.plot(chrom-t, chrom-y, mark: none, color: accent, stroke: 0.8pt),
  ..chrom.peaks.map(p => {
    if p.height > 1.5 {
      // The main peak is off the zoomed scale: label it beside the peak.
      lq.place(p.rt + 0.25, 1.3, align: left, text(7pt, fill: muted)[#p.name · #p.rt min \ off scale (#p.height mAU)])
    } else {
      lq.place(p.rt, p.height + 0.12, align: bottom, text(7pt, fill: muted)[#p.name \ #p.rt min])
    }
  }),
))
#text(7.5pt, fill: muted)[The y axis is zoomed to the impurity level; the paracetamol peak at #chrom.peaks.find(p => p.name == "Paracetamol").rt min reaches #chrom.peaks.find(p => p.name == "Paracetamol").height mAU.]

#table(
  columns: (1.5fr, 1fr, 1fr, 1fr, auto),
  align: (left, right, right, right, center),
  table.header([Peak], [RT (min)], [Area (%)], [Limit (%)], [Status]),
  ..chrom.peaks.map(p => (
    p.name,
    fmt(p.rt, 2),
    fmt(p.areaPercent, 2),
    if p.limitPercent == none [—] else [≤ #p.limitPercent],
    if p.limitPercent == none [—] else { badge(impurity-ok(p)) },
  )).flatten(),
  [*Total impurities*], [], [*#fmt(total-impurities, 2)*], [≤ 0.5], badge(total-impurities <= 0.5),
)

#section[Dissolution · 12 vessels]
#grid(
  columns: (1.3fr, 1fr),
  column-gutter: 14pt,
  align: horizon,
  lq.diagram(
    width: 7.6cm,
    height: 5.2cm,
    xlabel: [Time (min)],
    ylabel: [Dissolved (%)],
    ylim: (0, 105),
    legend: (position: bottom + right),
    ..dis.vesselTimes.zip(dis.vessels).map(((t, vs)) => lq.scatter(
      vs.map(_ => t),
      vs,
      size: 3pt,
      color: teal.transparentize(55%),
    )),
    lq.plot(dis.vesselTimes, dis-means, mark: "o", color: accent, label: [Mean of 12 vessels]),
    lq.hlines(dis.limit.percent + 5, stroke: (paint: fail, dash: "dashed"), label: [Q + 5 % (#(dis.limit.percent + 5) %)]),
  ),
  [
    #text(fill: muted)[#dis.medium] \
    #v(4pt)
    #table(
      columns: (auto, 1fr, 1fr, 1fr),
      align: right,
      table.header([min], [Mean], [Min], [Max]),
      ..dis.vesselTimes.zip(dis.vessels).map(((t, vs)) => (str(t), fmt(mean(vs), 1), fmt(calc.min(..vs), 1), fmt(calc.max(..vs), 1))).flatten(),
    )
    Lowest vessel at #dis.limit.minutes min: *#fmt(q-min, 1) %* #h(3pt) #badge(dis-ok)
  ],
)

#section[Conclusion]
#block(
  width: 100%,
  inset: 8pt,
  radius: 3pt,
  fill: if all-pass { rgb("#f0fdf4") } else { rgb("#fef2f2") },
  stroke: 0.6pt + if all-pass { pass } else { fail },
  [#badge(all-pass) #h(6pt) #data.conclusion],
)

#section[Approvals]
#grid(
  columns: (1fr,) * data.approvals.len(),
  column-gutter: 14pt,
  ..data.approvals.map(a => [
    #v(14pt)
    #line(length: 100%, stroke: 0.5pt + muted)
    #strong(a.name) \
    #text(fill: muted)[#a.role · #a.date]
  ]),
)
