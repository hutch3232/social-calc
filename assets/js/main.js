// main.js — Calculate expected Social Security benefits with survival probabilities
(function () {
  'use strict';

  const birthDate = document.getElementById('birthDate');
  const scheduleTbody = document.querySelector('#scheduleTable tbody');
  const benefitAmt = document.getElementById('benefitAmt');
  const globalRate = document.getElementById('globalRate');
  const marginalTax = document.getElementById('marginalTax');
  const retirementAgeEl = document.getElementById('retirementAge');
  const adjustedBenefitDisplay = document.getElementById('adjustedBenefitDisplay');
  const netBenefitDisplay = document.getElementById('netContributionDisplay');

  if (
    !birthDate ||
    !scheduleTbody ||
    !benefitAmt ||
    !globalRate ||
    !marginalTax ||
    !retirementAgeEl ||
    !adjustedBenefitDisplay ||
    !netBenefitDisplay
  ) {
    return;
  }

  const defaults = {
    defaultBenefit: 1000,
    defaultRate: 5.0,
    defaultBirthDate: '1970-01-01'
  };

  benefitAmt.value = defaults.defaultBenefit;
  globalRate.value = defaults.defaultRate;

  // Initialize flatpickr on the birth date input
  if (window.flatpickr) {
    flatpickr(birthDate, {
      dateFormat: 'Y-m-d',
      defaultDate: defaults.defaultBirthDate,
      allowInput: true,
      onChange: calculateSchedule
    });
  } else {
    // fallback to native input behavior
    birthDate.value = defaults.defaultBirthDate;
  }

  // Initialize Bootstrap tooltips for elements that declare them (e.g., the P(S) header)
  (function initTooltips() {
    if (window.bootstrap && bootstrap.Tooltip) {
      const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
      tooltipTriggerList.forEach(function (el) {
        try { new bootstrap.Tooltip(el); } catch (e) { /* ignore */ }
      });
    }
  })();

  // Selected dataset (parsed CSV rows) will be stored here for downstream analysis
  let selectedDataset = null;
  let selectedDatasetMap = null; // Map: age -> NumSurvivors
  let selectedDatasetMaxAge = null;
  let currentDatasetName = null;

  // wire dataset selector (exists in index.html)
  const datasetSelect = document.getElementById('datasetSelect');
  const datasetInfo = document.getElementById('datasetInfo');

  if (datasetSelect) {
    datasetSelect.addEventListener('change', () => loadSelectedDataset(datasetSelect.value));
    // try to load initial value
    if (datasetSelect.value) {
      loadSelectedDataset(datasetSelect.value);
    }
  }

  function getDatasetName(url) {
    const sel = document.querySelector('#datasetSelect');
    const optText = sel?.selectedOptions?.[0]?.text?.trim() || '';

    try {
      const rawName = decodeURIComponent(url.split('/').pop() || '');
      const nameFromFile = rawName.replace(/\.csv$/i, '').trim();
      return optText || nameFromFile || url;
    } catch (e) {
      return optText || url;
    }
  }

  function buildDatasetMap(dataset) {
    const map = new Map();
    let maxAge = null;

    for (const row of dataset) {
      const age = Number(row.Age);
      if (!Number.isInteger(age)) continue;

      const n = Number(row.NumSurvivors);
      if (Number.isFinite(n)) {
        map.set(age, n);
        if (maxAge === null || age > maxAge) {
          maxAge = age;
        }
      }
    }

    return { map, maxAge };
  }

  function isCorsOrFileError(err) {
    const msg = err?.message || String(err);
    return (
      window.location.protocol === 'file:' ||
      err instanceof ProgressEvent ||
      msg.includes('Failed to fetch') ||
      msg.includes('XMLHttpRequest') ||
      /^\[object .*Event\]$/.test(msg)
    );
  }

  function formatErrorMessage(err, context) {
    let msg = err?.message || String(err);

    // Provide actionable advice for common errors
    if (isCorsOrFileError(err)) {
      const advice = 'Likely blocked by CORS or running via file://. ' +
        'Serve the project with a local HTTP server ' +
        '(example: `python3 -m http.server 8000`) and try again.';
      msg = msg !== '[object XMLHttpRequestProgressEvent]' ? `${msg} — ${advice}` : advice;
    }

    return `${context}: ${msg}`;
  }

  function processDataset(dataset, url) {
    selectedDataset = dataset;

    // Build numeric map
    const { map, maxAge } = buildDatasetMap(dataset);
    selectedDatasetMap = map;
    selectedDatasetMaxAge = maxAge;

    // Update UI
    currentDatasetName = getDatasetName(url);
    datasetInfo.textContent = currentDatasetName;

    // Notify other parts of the app
    calculateSchedule();
  }

  function loadSelectedDataset(url) {
    if (!url) return;

    datasetInfo.textContent = 'Loading...';
    const encodedUrl = encodeURI(url);

    // Prefer PapaParse's download mode (it fetches + parses and surfaces errors)
    if (window.Papa?.parse) {
      Papa.parse(encodedUrl, {
        download: true,
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false, // Keep as strings, we'll convert manually
        complete: (parsed) => processDataset(parsed.data, url),
        error: (err) => {
          datasetInfo.textContent = formatErrorMessage(err, 'Error parsing dataset');
          console.error('PapaParse error', err);
        }
      });
      return;
    }

    fetch(encodedUrl)
      .then(resp => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.text();
      })
      .then(csvText => parseAndProcess(csvText, url))
      .catch(err => {
        datasetInfo.textContent = formatErrorMessage(err, 'Error loading dataset');
        console.error(err);
      });
  }

  function parseAndProcess(csvText, url) {
    try {
      let dataset;

      if (window.Papa?.parse) {
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        dataset = parsed.data;
      } else {
        // Minimal fallback: split rows and commas (not robust for complex CSVs)
        const rows = csvText.split(/\r?\n/).filter(Boolean);
        const headers = rows.shift().split(',').map(h => h.trim());
        dataset = rows.map(r => {
          const cols = r.split(',');
          const obj = {};
          headers.forEach((h, i) => obj[h] = cols[i] || '');
          return obj;
        });
      }

      processDataset(dataset, url);
    } catch (err) {
      datasetInfo.textContent = `Error parsing CSV: ${err.message}`;
      console.error(err);
    }
  }

  function getAgeYears(birth, asOfDate) {
    const by = birth.getFullYear();
    const bm = birth.getMonth();
    const bd = birth.getDate();
    const ay = asOfDate.getFullYear();
    const am = asOfDate.getMonth();
    const ad = asOfDate.getDate();
    let age = ay - by;
    if (am < bm || (am === bm && ad < bd)) age -= 1;
    return age;
  }

  function formatPercent(p) {
    return Number.isFinite(p) ? (p * 100).toFixed(1) + '%' : '—';
  }

  const currencyFormatter = new Intl.NumberFormat(navigator.language, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  });

  function formatCurrency(v) {
    return currencyFormatter.format(Number(v || 0));
  }

  // Update the adjusted and net benefit display without rebuilding the full table
  function updateBenefitDisplays() {
    const fullRetirementBenefit = Number(benefitAmt.value) || 0;
    const retirementAge = parseInt(retirementAgeEl.value, 10) || 67;
    const taxPct = Number(marginalTax.value) || 0;
    const adjustedMonthlyBenefit = computeAdjustedBenefit(fullRetirementBenefit, retirementAge);
    const monthlyBenefitNet = adjustedMonthlyBenefit * (1 - taxPct / 100);
    adjustedBenefitDisplay.textContent = formatCurrency(adjustedMonthlyBenefit);
    netBenefitDisplay.textContent = formatCurrency(monthlyBenefitNet);
  }

  function calculateSchedule() {
    const birth = new Date(birthDate.value + 'T00:00:00');
    if (Number.isNaN(birth.getTime())) return;

    const startAge = 62;

    // Clear table
    scheduleTbody.innerHTML = '';

    // Read financial inputs (always used)
    let balance = 0;
    let priorYearInterest = 0; // carry forward interest for April tax (starts at 0)
    let expectedValue = 0; // running total of expected value (with survival probabilities)

    const fullRetirementBenefit = Number(benefitAmt.value) || 0;
    const annualRate = Number(globalRate.value) || 0;
    const taxPct = Number(marginalTax.value) || 0;

    // compute adjusted benefit based on selected retirement age
    const retirementAge = Number(retirementAgeEl.value) || 67;
    const adjustedMonthlyBenefit = computeAdjustedBenefit(fullRetirementBenefit, retirementAge);
    const monthlyBenefitNet = adjustedMonthlyBenefit * (1 - taxPct / 100);

    // update adjusted / net displays
    adjustedBenefitDisplay.textContent = formatCurrency(adjustedMonthlyBenefit);
    netBenefitDisplay.textContent = formatCurrency(monthlyBenefitNet);

    const today = new Date();
    const userAge = getAgeYears(birth, today);
    // find base survivors for current age — if not present, walk downward to nearest age
    const baseNum = selectedDatasetMap.get(userAge);
    if (baseNum === undefined) {
      datasetInfo.textContent = `Dataset has no data for age ${userAge}`;
      return;
    }
    datasetInfo.textContent = currentDatasetName || 'Life table';

    for (let age = startAge; age <= selectedDatasetMaxAge; age++) {
      const row = document.createElement('tr');
      const bday = new Date(birth);
      bday.setFullYear(birth.getFullYear() + age);
      const yearCell = `<td>${bday.getFullYear()}</td>`;
      const ageCell = `<td>${age}</td>`;

      // Compute survival probability based on age relationships:
      // 1. If display age <= current age: probability is 1.0 (we know they survived to/past this age)
      // 2. Otherwise: P(survive to display age | survived to current age) = NumSurvivors(display age) / NumSurvivors(current age)
      let survivalProb;
      if (age <= userAge) {
        survivalProb = 1.0; // Already survived to/past this age
      } else {
        // Find survivors at target/display age (with fallbacks for missing data)
        let targetNum = selectedDatasetMap.get(age);
        // baseNum is survivors at userAge (denominator for conditional probability)
        survivalProb = (targetNum !== undefined && baseNum > 0) 
          ? Math.min(1.0, targetNum / baseNum) 
          : NaN;
      }

      const probCell = document.createElement('td');
      probCell.className = 'text-end align-middle';
      probCell.textContent = formatPercent(survivalProb);

      // financial: payments should start at the selected retirement age. Before that, no monthly benefit
      const monthlyPaymentThisYear = (age >= retirementAge) ? monthlyBenefitNet : 0;
      // compute end balance for this year using monthly compounding and apply April tax on prior year's interest
      const fin = computeYearEndWithTax(balance, monthlyPaymentThisYear, annualRate, taxPct, priorYearInterest);
      const endBal = fin.endBalance;
      const interestEarnedThisYear = fin.interestEarned;
      const yearActivity = monthlyPaymentThisYear * 12 + interestEarnedThisYear;

      // Create Future Value cell
      const balCell = document.createElement('td');
      balCell.className = 'text-end align-middle fw-semibold';
      balCell.textContent = formatCurrency(endBal);

      // Create Expected Future Value cell:
      // - First row: P(S) * FV
      // - Subsequent rows: Prior E[FV] + P(S) * (this year's payments + interest)
      const expectedCell = document.createElement('td');
      expectedCell.className = 'text-end align-middle fw-semibold';

      // If this is age 62 (first row), E[FV] is just P(S) * FV
      if (age === startAge) {
        expectedValue = endBal * survivalProb;
      } else {
        // Otherwise add P(S) * (this year's activity) to prior E[FV]
        expectedValue += yearActivity * survivalProb;
      }
      expectedCell.textContent = formatCurrency(expectedValue);

      row.innerHTML = yearCell + ageCell;
      row.appendChild(probCell);
      row.appendChild(balCell);
      row.appendChild(expectedCell);
      scheduleTbody.appendChild(row);
      balance = endBal;
      priorYearInterest = interestEarnedThisYear;
    }
    return;
  }

  // simulate a year with monthly benefits and apply tax on prior year's interest in April
  function computeYearEndWithTax(startBalance, monthlyPayment, annualRate, marginalTaxPct, priorYearInterest) {
    let balance = startBalance;
    let interestEarnedThisYear = 0;
    const rm = annualRate / 100 / 12;

    for (let month = 1; month <= 12; month++) {
      // At beginning of April (month === 4) apply tax on prior year's interest
      if (month === 4 && priorYearInterest > 0 && marginalTaxPct > 0) {
        const taxDue = priorYearInterest * (marginalTaxPct / 100);
        balance -= taxDue;
        if (balance < 0) balance = 0;
      }

      // monthly interest
      const interest = balance * rm;
      interestEarnedThisYear += interest;
      balance += interest;

      // add net monthly payment received (may be 0 before retirement)
      balance += monthlyPayment;
    }

    return { endBalance: balance, interestEarned: interestEarnedThisYear };
  }

  // Compute adjusted monthly benefit based on retirement age rules
  // Implemented as SSA-style monthly adjustments (no compounding):
  // - Full retirement age (FRA) is 67 => 100% of fullBenefit
  // - For early retirement (retireAge < FRA): reduction =
  //     monthsEarly = (FRA - retireAge) * 12
  //     first 36 months: 5/9 of 1% per month
  //     remaining months: 5/12 of 1% per month
  //   totalReductionPercent = monthsEarly<=36 ? monthsEarly*(5/9)% : 36*(5/9)% + (monthsEarly-36)*(5/12)%
  //   adjusted = fullBenefit * (1 - totalReductionPercent)
  // - For delayed retirement (retireAge > FRA): increase is linear 8% per year (not compounded):
  //   adjusted = fullBenefit * (1 + 0.08 * yearsDelayed)
  function computeAdjustedBenefit(fullBenefit, retireAge) {
    const FRA = 67;
    if (retireAge === FRA) return fullBenefit;
    if (retireAge > FRA) {
      const yearsDelayed = retireAge - FRA;
      return fullBenefit * (1 + 0.08 * yearsDelayed);
    }
    // Early retirement
    const monthsEarly = (FRA - retireAge) * 12;
    const perMonthFirst = 5 / 9 / 100; // 5/9 of 1% per month
    const perMonthAfter = 5 / 12 / 100; // 5/12 of 1% per month
    if (monthsEarly <= 36) {
      const reduction = monthsEarly * perMonthFirst; // fraction
      return fullBenefit * (1 - reduction);
    }
    const reduction = 36 * perMonthFirst + (monthsEarly - 36) * perMonthAfter;
    return fullBenefit * (1 - reduction);
  }

  // wire events
  // Support both 'input' and 'change' events for maximum browser compatibility (Safari fires 'change' on date select)
  function onBirthOrEndChange() {
    // picker shows the selected date; just recalc
    calculateSchedule();
  }

  birthDate.addEventListener('input', onBirthOrEndChange);
  birthDate.addEventListener('change', onBirthOrEndChange);

  // Ensure retirement age changes trigger an immediate recalculation. Some browsers/firewalls
  // may behave differently for select events, so listen for both 'input' and 'change'.
  // when global inputs change, recalc and update visible contribution/rate cells
  benefitAmt.addEventListener('input', () => calculateSchedule());
  benefitAmt.addEventListener('change', () => calculateSchedule());
  globalRate.addEventListener('input', () => calculateSchedule());
  globalRate.addEventListener('change', () => calculateSchedule());
  marginalTax.addEventListener('input', () => calculateSchedule());
  marginalTax.addEventListener('change', () => calculateSchedule());
  benefitAmt.addEventListener('input', () => updateBenefitDisplays());
  marginalTax.addEventListener('input', () => updateBenefitDisplays());
  retirementAgeEl.addEventListener('input', () => updateBenefitDisplays());
  retirementAgeEl.addEventListener('change', () => updateBenefitDisplays());
  retirementAgeEl.addEventListener('input', () => calculateSchedule());
  retirementAgeEl.addEventListener('change', () => calculateSchedule());

  // initial build
  calculateSchedule();

})();
