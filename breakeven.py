"""A breakeven analysis for Social Security benefits.

The following analysis is to help determine when my dad should
retire to maximize combined Social Security benefits.
My mom will retire first, and my dad will retire later to increase
his benefit. We want to find the breakeven point when the higher monthly
benefit from dad overtakes the baseline scenario of dad retiring earlier.
"""

import datetime

from benefits import Benefit, Breakeven, Couple, Option


def next_month(current_date: datetime.date) -> datetime.date:
    """Calculates the 1st day of the next month."""
    # Check for year rollover
    if current_date.month == 12:
        next_month = 1
        next_year = current_date.year + 1
    else:
        next_month = current_date.month + 1
        next_year = current_date.year

    return datetime.date(next_year, next_month, 1)


mom = Benefit(
    birthdate="1960-01-01",
    full_benefit=1000.00,
    retirement_date="2025-10-01",
)
dad = Benefit(birthdate="1960-06-01", full_benefit=3500.00)

only_m = mom.calculate_adjusted_benefit()
dad.calculate_adjusted_benefit(retirement_date="2025-12-01")
dad.get_fra()
dad.get_fra_date()
dad.get_max_benefit_age_date()

couple = Couple(mom, dad)

option_a = Option(couple, retirement_date2="2025-12-01")
option_b = Option(couple, retirement_date2="2026-06-01")
option_c = Option(couple, retirement_date2="2027-06-01")

options = Breakeven(baseline=option_a, alternatives=[option_b, option_c])

loop_date = datetime.date(2025, 12, 1)
# replace 0.0 with APR of expected return on investment
# it will be compounded monthly
growth_factor = 1 + 0.0 / 12
# portion of gains taxed as interest vs. capital gains
gain_pct_interest = 1.0
while True:
    year = loop_date.year  # year - 1 is the tax year
    month = loop_date.month
    tax_rate_federal = 0.24 if year - 1 <= 2027 else 0.22  # vary pre/post retirement
    tax_rate_state = 0.0
    tax_rate_county = 0.0
    tax_rate_ss = tax_rate_federal * 0.85  # up to 85% of SS benefits are taxable
    tax_rate_capital_gains = 0.0  # assuming no investment sales
    tax_rate_interest = tax_rate_federal + tax_rate_state + tax_rate_county

    for option in options.options:
        pmt = option.monthly_benefit if loop_date >= option.retirement_date2 else only_m
        pmt *= 1 - tax_rate_ss  # after tax
        if option.annual_payments.get(year) is None:
            option.annual_payments[year] = 0.0
        option.annual_payments[year] += pmt
        option.balance += pmt
        option.balance *= growth_factor
        if month == 4:
            # In April, pay taxes on last year's gains
            gain = (
                option.eoy_balances.get(year - 1, 0)
                - option.eoy_balances.get(year - 2, 0)
                - option.annual_payments.get(year - 1, 0)
            )
            option.balance -= gain * (
                gain_pct_interest * tax_rate_interest
                + (1 - gain_pct_interest) * tax_rate_capital_gains
            )
        if month == 12:
            option.eoy_balances[year] = option.balance

        if option == options.baseline:
            continue
        if option.breakeven_date is None and option.balance >= options.baseline.balance:
            option.breakeven_date = loop_date

    if all(option.breakeven_date is not None for option in options.alternatives):
        break
    if loop_date.year > 2100:
        print("Loop exceeded reasonable date range.")
        break
    loop_date = next_month(loop_date)

for option in options.alternatives:
    print(
        f"Option {option.retirement_date2} overtakes baseline on: "
        f"{option.breakeven_date}. Balance: ${option.balance:,.2f}"
    )
