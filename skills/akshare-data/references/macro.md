# 宏观经济数据接口速查

## 目录
- [中国宏观](#中国宏观)
- [美国宏观](#美国宏观)
- [欧元区](#欧元区)
- [全球宏观](#全球宏观)

---

## 中国宏观

```python
# GDP
ak.macro_china_gdp()

# CPI 居民消费价格指数
ak.macro_china_cpi()

# CPI 年率
ak.macro_china_cpi_yearly()

# CPI 月率
ak.macro_china_cpi_monthly()

# PPI 工业品出厂价格指数
ak.macro_china_ppi()

# PMI 采购经理指数
ak.macro_china_pmi()

# 非制造业 PMI
ak.macro_china_non_man_pmi()

# 货币供应量 (M0, M1, M2)
ak.macro_china_money_supply()

# 社会融资规模
ak.macro_china_shrzgm()

# 社会消费品零售总额
ak.macro_china_consumer_goods_retail()

# 工业增加值
ak.macro_china_industrial_production_yoy()

# 固定资产投资
ak.macro_china_fai()

# 房地产投资
ak.macro_china_real_estate()

# 财新 PMI（制造业）
ak.macro_china_cx_pmi()

# 财新 PMI（服务业）
ak.macro_china_cx_services_pmi()

# 宏观杠杆率
ak.macro_cnbs()
# 返回: 居民杠杆率, 非金融企业杠杆率, 政府杠杆率, 中央政府, 地方政府, 实体经济, 金融部门(资产方), 金融部门(负债方)

# 外汇储备
ak.macro_china_fx_reserves_yearly()

# 失业率
ak.macro_china_urban_unemployment()

# 城镇新增就业
ak.macro_china_new_house_price()

# 进出口贸易
ak.macro_china_trade_balance()

# 新增人民币贷款
ak.macro_china_new_financial_credit()

# LPR 利率
ak.macro_china_lpr()

# 存款利率
ak.macro_china_deposit_rate()

# 贷款利率
ak.macro_china_lending_rate()

# 存款准备金率
ak.macro_china_reserve_requirement_ratio()

# Shibor 利率
ak.macro_china_shibor_all()

# 国债收益率（中国）
ak.bond_china_yield(start_date="20240101", end_date="20241231")

# 民间固定资产投资
ak.macro_china_private_fai()

# 规模以上工业利润
ak.macro_china_industrial_profit_yoy()
```

## 美国宏观

```python
# 美国 GDP
ak.macro_usa_gdp_monthly()

# 美国 CPI 月率
ak.macro_usa_cpi_monthly()

# 美国核心 CPI 月率
ak.macro_usa_core_cpi_monthly()

# 美国 PPI 月率
ak.macro_usa_ppi()

# 美国 PMI
ak.macro_usa_ism_pmi()

# 美国非制造业 PMI
ak.macro_usa_ism_non_pmi()

# 美国非农就业人数
ak.macro_usa_non_farm()

# 美国失业率
ak.macro_usa_unemployment_rate()

# 美国 ADP 就业人数
ak.macro_usa_adp_employment()

# 美国初请失业金人数
ak.macro_usa_initial_jobless()

# 美国贸易余额
ak.macro_usa_trade_balance()

# 美国零售销售月率
ak.macro_usa_retail_sales()

# 美国消费者信心指数
ak.macro_usa_michigan_consumer_sentiment()

# 美国新屋开工
ak.macro_usa_building_permits()

# 美国成屋销售
ak.macro_usa_exist_home_sales()

# 美国新屋销售
ak.macro_usa_new_home_sales()

# 美联储利率决议
ak.macro_usa_interest_rate()

# 美国 EIA 原油库存
ak.macro_usa_eia_crude_rate()

# 美国国债收益率
ak.bond_usa_yield(start_date="20240101", end_date="20241231")
```

## 欧元区

```python
# 欧元区 GDP 季率
ak.macro_euro_gdp_yoy()

# 欧元区 CPI 月率
ak.macro_euro_cpi_mom()

# 欧元区 CPI 年率
ak.macro_euro_cpi_yoy()

# 欧元区 PPI 月率
ak.macro_euro_ppi_mom()

# 欧元区失业率
ak.macro_euro_unemployment_rate_mom()

# 欧元区 PMI
ak.macro_euro_manufacturing_pmi()

# 欧央行利率决议
ak.macro_euro_interest_rate()

# 欧元区贸易帐
ak.macro_euro_trade_balance()

# 欧元区零售销售月率
ak.macro_euro_retail_sales_mom()
```

## 全球宏观

```python
# 全球宏观事件日历
ak.news_economic_baidu(date="20240101")

# OPEC 报告
ak.macro_cons_opec_month()

# SPDR 黄金 ETF 持仓
ak.macro_cons_gold()

# iShares 白银 ETF 持仓
ak.macro_cons_silver()

# LME 伦铜库存
ak.macro_cons_gold_volume()

# CFTC 持仓报告
ak.macro_usa_cftc(symbol="黄金")
# symbol: 各商品名称

# 日本央行利率决议
ak.macro_japan_interest_rate()

# 英国央行利率决议
ak.macro_uk_interest_rate()

# 澳大利亚央行利率决议
ak.macro_australia_interest_rate()

# 加拿大央行利率决议
ak.macro_canada_interest_rate()

# 瑞士央行利率决议
ak.macro_swiss_interest_rate()
```
