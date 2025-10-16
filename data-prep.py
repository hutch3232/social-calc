import polars as pl

for i in range(1, 19):
    df = pl.read_excel(f"data/Table{i:02}.xlsx", has_header=False)
    tbl_nm = df.slice(0, 1)["column_1"].item().strip()
    df = (
        df.select("column_1", "column_3")
        .slice(3)
        .rename({"column_1": "Age", "column_3": "NumSurvivors"})
        .with_columns(pl.col("Age").str.split("–").list.first())
    )

    df = df.filter(pl.col("NumSurvivors").is_not_null()).with_columns(
        pl.when(pl.col("Age").str.starts_with("100"))
        .then(pl.lit("100"))
        .otherwise(pl.col("Age"))
        .cast(pl.Int8)
        .alias("Age"),
    )
    
    df.write_csv(
        f"data/{tbl_nm}.csv"
    )
