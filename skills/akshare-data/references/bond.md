# 债券数据接口速查

## 目录
- [可转债](#可转债)
- [国债与债券收益率](#国债与债券收益率)
- [债券行情](#债券行情)

---

## 可转债

```python
# 可转债实时行情
ak.bond_cb_jsl(cookie="")
# 返回: 转债代码, 转债名称, 现价, 涨跌幅, 正股代码, 正股名称, 正股价, 转股价, 转股价值, 溢价率, 到期收益率, 剩余年限, 回售触发价, 强赎触发价, 到期时间

# 可转债历史行情-东财
ak.bond_zh_hs_cov_daily(symbol="sh113050")
# symbol: sh+代码(沪市) / sz+代码(深市)

# 可转债-实时行情-集思录
ak.bond_cb_index_jsl()

# 可转债列表-东财
ak.bond_cb_redeem_jsl()

# 可转债-基本信息
ak.bond_cb_profile_sina(symbol="sh113050")
```

## 国债与债券收益率

```python
# 中国国债收益率曲线
ak.bond_china_yield(start_date="20240101", end_date="20241231")
# 返回: 曲线名称, 日期, 3月, 6月, 1年, 3年, 5年, 7年, 10年, 30年

# 美国国债收益率
ak.bond_usa_yield(start_date="20240101", end_date="20241231")

# 中美国债收益率对比
ak.bond_zh_us_rate(start_date="20240101")
```

## 债券行情

```python
# 沪深债券实时行情
ak.bond_zh_hs_spot()

# 沪深债券历史行情
ak.bond_zh_hs_daily(symbol="sh010107")

# 债券回购行情
ak.bond_repo_zh_tick(code="204001")

# 银行间可质押回购利率
ak.rate_interbank(market="质押式回购利率", need="DR007")
# market: "质押式回购利率"/"买断式回购利率"/"同业拆借利率"

# Shibor 利率
ak.macro_china_shibor_all()

# 国债逆回购
ak.bond_repo_zh_tick(code="204001")
# code: 204001(GC001) / 204007(GC007) / 131810(R-001) 等
```
