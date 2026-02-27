# 基金数据接口速查

## 目录
- [ETF基金](#etf基金)
- [公募基金](#公募基金)
- [基金排名](#基金排名)

---

## ETF基金

```python
# ETF 实时行情
ak.fund_etf_spot_em()
# 返回: 代码, 名称, 最新价, 涨跌幅, 涨跌额, 成交量, 成交额, 开盘价, 最高价, 最低价, 昨收, 换手率

# ETF 历史行情
ak.fund_etf_hist_em(symbol="510300", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")
# symbol: ETF代码
# period: daily/weekly/monthly

# ETF 分时数据
ak.fund_etf_hist_min_em(symbol="510300", period="1", start_date="2024-01-01 09:30:00", end_date="2024-01-01 15:00:00", adjust="")

# LOF 实时行情
ak.fund_lof_spot_em()

# LOF 历史行情
ak.fund_lof_hist_em(symbol="161725", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")
```

## 公募基金

```python
# 基金列表-开放式
ak.fund_name_em()
# 返回: 基金代码, 基金简称, 基金类型

# 基金净值-开放式
ak.fund_open_fund_info_em(symbol="000001", indicator="单位净值走势")
# indicator: "单位净值走势"/"累计净值走势"/"同类排名走势"/"同类排名百分比"/"分红送配详情"/"拆分详情"

# 基金净值-货币型
ak.fund_money_fund_info_em(symbol="000509")

# 基金历史净值（东财）
ak.fund_open_fund_daily_em()

# 基金排行-近期业绩
ak.fund_open_fund_rank_em(symbol="全部")
# symbol: "全部"/"股票型"/"混合型"/"债券型"/"指数型"/"QDII"

# 基金持仓
ak.fund_portfolio_hold_em(symbol="000001", date="2024")
# date: 年份

# 基金规模变动
ak.fund_portfolio_change_em(symbol="000001")

# 基金公司排名
ak.fund_aum_em()

# 基金经理排名
ak.fund_manager_em()

# ETF 持仓
ak.fund_etf_fund_info_em(fund="510300")
```

## 基金排名

```python
# 基金排行-日排名
ak.fund_exchange_rank_em()

# 基金业绩排名-近1年
ak.fund_open_fund_rank_em(symbol="股票型")

# 基金经理业绩
ak.fund_manager_em()
```
