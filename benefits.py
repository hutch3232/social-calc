"""Social Security benefit models and helpers.

This module provides small, focused classes to model individual and
couple Social Security benefits and to compute adjusted monthly benefits
based on retirement timing.

Key classes:
- `Benefit`: represents an individual's Primary Insurance Amount (PIA),
    birthdate and retirement behavior and computes adjusted benefits for
    early or delayed claiming according to SSA rules.
- `Couple`: models two `Benefit` instances and computes combined
    (including spousal) benefits.
- `Option` and `Breakeven`: small containers used by the project's
    breakeven calculations.

Calculations in this module use month-granularity (SSA counts age by
month rather than by exact day).
"""

import datetime

FRA_MAPPING = [
    (1960, (67, 0)),
    (1959, (66, 10)),
    (1958, (66, 8)),
    (1957, (66, 6)),
    (1956, (66, 4)),
    (1955, (66, 2)),
    (1943, (66, 0)),
]
PER_MONTH_FIRST_36 = (5 / 9) / 100
PER_MONTH_AFTER_36 = (5 / 12) / 100
PER_MONTH_DELAYED = (2 / 3) / 100


class Benefit:
    """Model for an individual's Social Security benefit.

    This class encapsulates a person's birthdate and their full benefit
    (Primary Insurance Amount at FRA). It provides helpers to find the
    Full Retirement Age (FRA) in years/months, the FRA date and the
    adjusted monthly benefit for an arbitrary retirement date.

    Attributes
    ----------
    birthdate: datetime.date
        The person's birth date.
    full_benefit: float
        The PIA or full monthly benefit at FRA.
    retirement_date: str | None
        Optional ISO date string used as a default retirement date for
        benefit calculations.
    """

    def __init__(
        self,
        birthdate: str,
        full_benefit: float,
        retirement_date: str | None = None,
    ) -> None:
        """
        Initializes the Benefit object.

        Args:
            birthdate: The person's birthdate in 'YYYY-MM-DD' format.
            full_benefit: The person's full Social Security benefit at FRA.
            retirement_date: The date the person plans to retire (optional).
        """
        self.birthdate = datetime.date.fromisoformat(birthdate)
        self.full_benefit = full_benefit
        self.retirement_date = retirement_date

    def get_fra(self) -> tuple[int, int]:
        """Return the FRA as a (years, months) tuple based on birth year.

        Raises
        ------
        ValueError
            If the birth year is outside the supported range (1943+).
        """
        for min_year, fra_age in FRA_MAPPING:
            if self.birthdate.year >= min_year:
                return fra_age
        raise ValueError(
            f"Birth year {self.birthdate.year} is outside the supported range (1943+)."
        )

    def get_fra_date(self) -> datetime.date:
        """Compute the calendar date corresponding to FRA.

        The SSA counts ages by month, not by exact day. For this
        project we use the first day of the FRA month as the FRA
        effective date (so comparisons use whole months).
        """
        fra_years, fra_months = self.get_fra()
        target_year = self.birthdate.year + fra_years
        target_month = self.birthdate.month + fra_months
        if target_month > 12:
            target_year += (target_month - 1) // 12
            target_month = (target_month - 1) % 12 + 1

        # Return the first day of the FRA month; this aligns with the
        # module's month-based calculations.
        return datetime.date(target_year, target_month, 1)

    def get_max_benefit_age_date(self) -> datetime.date:
        """Return the month (as a date on day 1) when the person turns 70.

        Returns
        -------
        datetime.date
            The first day of the month in which the person reaches age 70.
        """
        return datetime.date(self.birthdate.year + 70, self.birthdate.month, 1)

    def calculate_adjusted_benefit(self, retirement_date: str | None = None) -> float:
        """Return the adjusted monthly benefit for a retirement date.

        Parameters
        ----------
        retirement_date : str | None
            ISO date string (YYYY-MM-DD). If omitted, the instance's
            `retirement_date` attribute is used. A `ValueError` is raised
            when no retirement date is available.

        Behavior
        --------
        - If the retirement month equals FRA month the full benefit is
          returned.
        - For early claiming, reductions use SSA rules: 5/9 of 1% per
          month for the first 36 months, then 5/12 of 1% thereafter.
        - For delayed claiming, the Delayed Retirement Credit is applied
          at 2/3 of 1% per month until age 70 (the module clamps any
          later dates to the age-70 month).

        Returns
        -------
        float
            The monthly benefit rounded as a float.
        """
        if retirement_date is None:
            retirement_date = self.retirement_date
        if retirement_date is None:
            raise ValueError("'retirement_date' must be provided.")

        retirement_date = datetime.date.fromisoformat(retirement_date)
        fra_date = self.get_fra_date()

        months_diff = (retirement_date.year - fra_date.year) * 12 + (
            retirement_date.month - fra_date.month
        )

        if months_diff == 0:
            return self.full_benefit

        if months_diff < 0:
            months_early = abs(months_diff)
            if months_early <= 36:
                reduction = months_early * PER_MONTH_FIRST_36
            else:
                reduction = (
                    36 * PER_MONTH_FIRST_36 + (months_early - 36) * PER_MONTH_AFTER_36
                )
            bene = self.full_benefit * (1 - reduction)
        else:
            max_benefit_date = self.get_max_benefit_age_date()
            if retirement_date > max_benefit_date:
                retirement_date: datetime.date = max_benefit_date

            months_delayed = (retirement_date.year - fra_date.year) * 12 + (
                retirement_date.month - fra_date.month
            )
            increase = months_delayed * PER_MONTH_DELAYED
            bene = self.full_benefit * (1 + increase)

        return bene

    def __repr__(self) -> str:
        return f"Benefit(birthdate={self.birthdate}, full_benefit={self.full_benefit})"


class Couple:
    """Model for a couple's Social Security benefits.

    The `Couple` class accepts two `Benefit` instances and can compute
    each spouse's adjusted benefit and the couple's combined monthly
    benefit. Spousal benefits: if a spouse claims a
    spousal benefit it is modeled as up to 50% of the other spouse's
    *full* benefit, reduced by their own PIA, and added to their
    adjusted benefit.
    """

    def __init__(self, person1: Benefit, person2: Benefit) -> None:
        """
        Initializes the Couple object.

        Args:
            person1: The first person's Benefit object.
            person2: The second person's Benefit object.
        """
        self.person1 = person1
        self.person2 = person2

    def calculate_joint_benefits(
        self,
        retirement_date1: str | None = None,
        retirement_date2: str | None = None,
    ) -> dict[str, float]:
        """Compute adjusted benefits for both people and the couple total.

        Parameters
        ----------
        retirement_date1, retirement_date2 : str | None
            ISO date strings for each person's retirement date. If omitted,
            the `Benefit` instance's `retirement_date` is used.

        Returns
        -------
        dict[str, float]
            Keys: `person1_benefit`, `person2_benefit`, `total_joint_benefit`.
        """
        benefit1 = self.person1.calculate_adjusted_benefit(retirement_date1)
        benefit2 = self.person2.calculate_adjusted_benefit(retirement_date2)

        spousal_benefit1 = max(
            0, (self.person2.full_benefit / 2) - self.person1.full_benefit
        )
        spousal_benefit2 = max(
            0, (self.person1.full_benefit / 2) - self.person2.full_benefit
        )

        total_benefit1 = benefit1 + spousal_benefit1
        total_benefit2 = benefit2 + spousal_benefit2

        return {
            "person1_benefit": round(total_benefit1, 2),
            "person2_benefit": round(total_benefit2, 2),
            "total_joint_benefit": round(total_benefit1 + total_benefit2, 2),
        }

    def __repr__(self) -> str:
        return f"Couple(person1={self.person1}, person2={self.person2})"


class Option:
    """Container representing a retirement option for a couple.

    `Option` packages a `Couple` with chosen retirement months and stores
    computed monthly benefit and some bookkeeping fields used elsewhere
    in the project.
    """

    def __init__(
        self,
        couple: Couple,
        retirement_date1: str | None = None,
        retirement_date2: str | None = None,
    ) -> None:
        self.couple = couple

        self.retirement_date1 = (
            datetime.date.fromisoformat(retirement_date1)
            if retirement_date1 is not None
            else couple.person1.retirement_date
        )
        self.retirement_date2 = (
            datetime.date.fromisoformat(retirement_date2)
            if retirement_date2 is not None
            else couple.person2.retirement_date
        )

        self.monthly_benefit = couple.calculate_joint_benefits(
            retirement_date1=retirement_date1,
            retirement_date2=retirement_date2,
        ).get("total_joint_benefit")

        # bookkeeping fields
        self.balance = 0.0
        self.annual_payments = {}
        self.eoy_balances = {}
        self.breakeven_date = None

    def __repr__(self) -> str:
        return (
            f"Option(couple={self.couple}), "
            f"retirement_date1={self.retirement_date1}, "
            f"retirement_date2={self.retirement_date2})"
        )


class Breakeven:
    """Simple container for breakeven analysis inputs.

    Holds a baseline `Option` and a list of alternative `Option` instances.
    """

    def __init__(self, baseline: Option, alternatives: list[Option]) -> None:
        self.baseline = baseline
        self.alternatives = alternatives
        self.options = [baseline, *alternatives]

    def __repr__(self) -> str:
        return f"Breakeven(baseline={self.baseline}, alternatives={self.alternatives})"
