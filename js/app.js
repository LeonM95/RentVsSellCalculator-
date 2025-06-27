/* =======================================================================
 *  app.js – Rent vs Sell (matches RLPMG calculator 1-for-1)
 * =====================================================================*/
"use strict";

/* ── mini helper ────────────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const pct = (x) => (x >= 1 ? x / 100 : x); // 6 → 0.06
const $f = (n) => "$" + Math.round(n).toLocaleString(); // 12345 → $12,345

/* ── elements we read/write ─────────────────────────────────────────── */
const tbody = document.querySelector("table tbody");
const form = $("formInputs");

const outRent = $("summary_rent_out");
const outSell = $("summary_sell_out");
const outDiff = $("summary_dif_wealth");

/* link every slider <input type=range> with its numeric <input> + label */
document.querySelectorAll("[data-range]").forEach((r) =>
  r.addEventListener("input", () => {
    const t = $(r.dataset.range);
    if (t) t.value = r.value;
    const l = $(r.dataset.label);
    if (l) l.textContent = r.value;
  })
);

/* =======================================================================
 *  1.  FINANCIAL LOGIC  (exactly mirrors rlpmg.com)
 * =====================================================================*/

/* annual collected rent (after vacancy) */
const rentYear = (yr, p) =>
  p.monthlyRent * 12 * (1 - p.vacancy) * (1 + p.rentGrowth) ** (yr - 1);

/* amortise a whole year of payments */
function amortize(balance, rMonthly, PI) {
  let int = 0;
  for (let i = 0; i < 12 && balance > 0; i++) {
    const ip = balance * rMonthly,
      pp = PI - ip;
    int += ip;
    balance -= pp;
  }
  return { balance, int };
}

/* “Other Costs” (exact recipe from rlpmg) */
function otherCosts(
  yr,
  { houseVal, rent, taxRate, insuranceAnnual, mgmtPct, maintPct }
) {
  const midValue =
    houseVal * (1 + 0.5 * pct($("appreciationRateInput").value || 3.5));
  const propTax = midValue * taxRate; // mid-year assessed value
  const insure = insuranceAnnual; // $/yr
  const mgmt = rent * mgmtPct; // 5.5 % of rent
  const maint = rent * maintPct; // 3.35 % of rent
  return {
    propTax,
    insure,
    mgmt,
    maint,
    total: propTax + insure + mgmt + maint,
  };
}

/* simulate whole holding period */
function simulate(p) {
  // convert % inputs to decimals
  [
    "rentGrowth",
    "vacancy",
    "taxRate",
    "appreciation",
    "realtor",
    "closing",
    "incomeTax",
    "reinvest",
  ].forEach((k) => (p[k] = pct(p[k])));

  const rMonthly = p.rate / 12,
    PI = p.monthlyPI,
    yrs = p.years;
  let bal = p.mortBalance,
    cash = -p.makeReady;
  let wealthSell = p.homeVal * (1 - p.realtor - p.closing) - bal;

  const rows = [];
  for (let y = 1; y <= yrs; y++) {
    const rent = rentYear(y, p);
    const { balance: intBal, int: interest } = amortize(bal, rMonthly, PI);
    const mortPay = PI * 12;
    bal = intBal;

    const houseVal = p.homeVal * (1 + p.appreciation) ** (y - 1);
    const OC = otherCosts(y, {
      houseVal,
      rent,
      taxRate: p.taxRate,
      insuranceAnnual: p.insAnnual,
      mgmtPct: p.mgmtPct,
      maintPct: p.maintPct,
    });

    /* cash-flow before tax */
    const preTax = rent - mortPay - OC.total;

    /* taxable income: rent – interest – deductible OPEX
       (maintenance isn’t deductible in rlpmg model) */
    const taxable = Math.max(
      rent - interest - OC.propTax - OC.insure - OC.mgmt,
      0
    );
    const tax = taxable * p.incomeTax;

    const after = preTax - tax; // net cash-flow

    cash = cash * (1 + p.reinvest) + after; // reinvested every year
    const equity = houseVal - bal;
    const wrent = equity + cash;

    if (y > 1) wealthSell *= 1 + p.reinvest;

    rows.push({
      Year: y,
      RentalIncome: $f(rent),
      Mortgage: "-" + $f(mortPay),
      OtherCosts: "-" + $f(OC.total),
      NetCashFlow: (after < 0 ? "-" : "") + $f(Math.abs(after)),
      HouseValue: $f(houseVal),
      HouseEquity: $f(equity),
      WealthRent: $f(wrent),
      WealthSell: $f(wealthSell),
      Diff: $f(wrent - wealthSell),
    });
  }
  return rows;
}

/* =======================================================================
 *  2.  READ FORM → PARAM OBJECT
 * =====================================================================*/
function readInputs() {
  const hv = +$("homeValueInput").value || 450000;

  /* detect property-tax: % (<100) vs $/yr (≥100) */
  const taxRaw = +$("propertyTaxesInput").value || 1.6;
  const taxRate = taxRaw < 100 ? taxRaw / 100 : taxRaw / hv;

  /* detect insurance: $/mo (<1000) vs $/yr (≥1000) */
  const insRaw = +$("homeownersInsuranceInput").value || 115;
  const insAnnual = insRaw < 1000 ? insRaw * 12 : insRaw;

  /* mortgage */
  const term = $("btn30years")?.checked
    ? 360
    : $("btn15years")?.checked
    ? 180
    : (+$("mortgageTermCustomInput").value || 30) * 12;
  const rate = pct(+$("interestRateInput").value || 5);
  const orig = +$("originalMortgageInput").value || 250000;
  const PI =
    +$("mortgagePaymentInput").value ||
    (orig * rate) / 12 / (1 - (1 + rate / 12) ** -term);

  return {
    /* base */
    homeVal: hv,
    mortBalance: +$("mortgageBalanceInput").value || 200000,
    rate,
    monthlyPI: PI,
    years: +$("yearsToHoldRange").value || 10,
    makeReady: +$("MakeReadyCostsInput").value || 3000,

    /* rent inputs */
    monthlyRent: +$("monthlyRentInput").value || 2500,
    rentGrowth: +$("annualRentChangeInput").value || 3,
    vacancy: +$("annualVacancyRateInput").value || 8,

    /* cost parameters (fixed to match rlpmg) */
    taxRate: taxRate, // %
    insAnnual: insAnnual, // $
    mgmtPct: pct(5.5), // 5.5 % de la renta
    maintPct: pct(3.35), // 3.35 % de la renta

    /* value growth / sale */
    appreciation: +$("appreciationRateInput").value || 3.5,
    realtor: +$("realtorCommissionInput").value || 6,
    closing: +$("closingCostsInputs").value || 3,

    /* taxes & reinvestment */
    incomeTax: +$("incomeTaxRateInput").value || 10,
    reinvest: +$("AfterTaxReinvestmentRateInput").value || 6,
  };
}

/* =======================================================================
 *  3.  RENDER TABLE & SUMMARY
 * =====================================================================*/
function render() {
  const rows = simulate(readInputs());
  tbody.innerHTML = "";
  rows.forEach((r) => {
    tbody.insertAdjacentHTML(
      "beforeend",
      `
      <tr><td>${r.Year}</td><td>${r.RentalIncome}</td>
      <td>${r.Mortgage}</td><td>${r.OtherCosts}</td>
      <td>${r.NetCashFlow}</td><td>${r.HouseValue}</td>
      <td>${r.HouseEquity}</td><td>${r.WealthRent}</td>
      <td>${r.WealthSell}</td><td>${r.Diff}</td></tr>`
    );
  });
  const last = rows.at(-1);
  outRent.textContent = last.WealthRent;
  outSell.textContent = last.WealthSell;
  outDiff.textContent = last.Diff;
}

/* =======================================================================
 *  4.  INIT & AUTO-UPDATE
 * =====================================================================*/
render(); // first draw
form.addEventListener("input", render);
form.addEventListener("submit", (e) => {
  e.preventDefault();
  render();
});

// Function to export table to PDF
// Function to export table to PDF
// Function to export table to PDF

function exportTableToPDF() {
  // Create a new window for printing
  const printWindow = window.open("", "_blank");

  // Get the table HTML (you'll need to identify your table element)
  // Assuming your table has an ID or is inside a specific container
  const tableElement = document.querySelector("table"); // Adjust selector as needed

  if (!tableElement) {
    alert("Table not found. Please make sure the table is rendered.");
    return;
  }

  // Create the HTML content for the print window
  const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Rent vs Sell Analysis</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 20px;
                    color: #333;
                }
                h1 {
                    text-align: center;
                    color: #2c3e50;
                    margin-bottom: 30px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 20px 0;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 8px;
                    text-align: right;
                }
                th {
                    background-color: #34495e;
                    color: white;
                    font-weight: bold;
                }
                tr:nth-child(even) {
                    background-color: #f9f9f9;
                }
                tr:hover {
                    background-color: #f5f5f5;
                }
                .disclaimer {
                    font-size: 10px;
                    color: #666;
                    margin-top: 20px;
                    padding: 10px;
                    background-color: #f8f9fa;
                    border-left: 3px solid #007bff;
                }
                @media print {
                    body { margin: 0; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <h1>Rent vs Sell Financial Analysis</h1>
            ${tableElement.outerHTML}
            <div class="disclaimer">
                <strong>Disclaimer:</strong> This data is provided for informational purposes only and should not be relied upon as a guarantee of any future result. Consult a qualified professional before making any financial decisions. A positive difference in projected wealth does not necessarily indicate positive monthly cash flow. It reflects long-term equity growth, appreciation, and other factors that may not translate into immediate income or liquidity.
            </div>
            <script>
                // Auto-print when the window loads
                window.onload = function() {
                    window.print();
                    // Close the window after printing (optional)
                    setTimeout(function() {
                        window.close();
                    }, 1000);
                };
            </script>
        </body>
        </html>
    `;

  // Write the HTML content to the new window
  printWindow.document.write(htmlContent);
  printWindow.document.close();
}

// Add event listener to the export button
document.addEventListener("DOMContentLoaded", function () {
  const exportBtn = document.getElementById("exportBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportTableToPDF);
  }
});

// Function to sync range sliders with number inputs and labels
// Function to sync range sliders with number inputs and labels
// Function to sync range sliders with number inputs and labels
function syncRangeInputs() {
  // Find all range inputs
  const rangeInputs = document.querySelectorAll('input[type="range"]');

  rangeInputs.forEach((rangeInput) => {
    // Add event listener for input changes
    rangeInput.addEventListener("input", function () {
      const value = this.value;

      // Method 1: Using data attributes (if you have data-target, data-label attributes)
      if (this.dataset.target) {
        const targetInput = document.getElementById(this.dataset.target);
        if (targetInput) {
          targetInput.value = value;
        }
      }

      if (this.dataset.label) {
        const targetLabel = document.getElementById(this.dataset.label);
        if (targetLabel) {
          targetLabel.textContent = value;
        }
      }

      // Method 3: Based on ID patterns (common naming conventions)
      const rangeId = this.id;
      if (rangeId) {
        // Try to find corresponding input by replacing 'Range' with 'Input'
        const inputId = rangeId
          .replace("Range", "Input")
          .replace("Slider", "Input");
        const correspondingInput = document.getElementById(inputId);
        if (correspondingInput) {
          correspondingInput.value = value;
        }

        // Try to find corresponding label by replacing 'Range' with 'Label'
        const labelId = rangeId
          .replace("Range", "Label")
          .replace("Slider", "Label");
        const correspondingLabel = document.getElementById(labelId);
        if (correspondingLabel) {
          correspondingLabel.textContent = value;
        }
      }
    });

    // Also sync when number input changes (reverse sync)
    const container =
      rangeInput.closest("div, section, fieldset") || rangeInput.parentElement;
    const numberInput = container.querySelector('input[type="number"]');

    if (numberInput) {
      numberInput.addEventListener("input", function () {
        const value = this.value;
        rangeInput.value = value;

        // Update any labels as well
        const labels = container.querySelectorAll("label, span, div");
        labels.forEach((label) => {
          const labelText = label.textContent.trim();
          if (
            /^\d+\.?\d*$/.test(labelText) ||
            label.classList.contains("slider-value")
          ) {
            label.textContent = value;
          }
        });
      });
    }
  });
}

// Initialize the sync functionality
document.addEventListener("DOMContentLoaded", function () {
  syncRangeInputs();
});

// chart
// chart
// chart
