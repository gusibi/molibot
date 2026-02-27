# 期货数据接口速查

## 目录
- [期货行情](#期货行情)
- [持仓排名](#持仓排名)
- [基础信息](#基础信息)
- [仓单与交割](#仓单与交割)

---

## 期货行情

```python
# 内盘期货实时行情
ak.futures_zh_spot()

# 内盘期货实时行情（品种分类）
ak.futures_zh_realtime(symbol="沪铜")
# symbol: 品种名称如"沪铜"/"沪铝"/"螺纹钢"/"铁矿石"等

# 内盘期货历史行情-东财
ak.futures_zh_daily_sina(symbol="RB0")
# symbol: 品种代码+0为连续合约，如 RB0(螺纹钢), AU0(黄金)

# 内盘期货历史行情-新浪
ak.futures_main_sina(symbol="V0", start_date="20240101", end_date="20241231")

# 外盘期货实时行情
ak.futures_foreign_commodity_realtime(symbol="伦敦金")
# symbol: "伦敦金"/"伦敦银"/"CME黄金"/"COMEX白银"/"WTI原油"/"布伦特原油"/"天然气" 等

# 外盘期货历史行情-东财
ak.futures_foreign_hist(symbol="伦敦金")

# 外盘期货历史行情-新浪
ak.futures_foreign_detail(symbol="ZSD")

# 期货连续合约（主力合约）
ak.futures_main_sina(symbol="V0", start_date="20240101", end_date="20241231")

# 期货分时数据
ak.futures_zh_minute_sina(symbol="RB0", period="1")
# period: "1"/"5"/"15"/"30"/"60"
```

## 持仓排名

```python
# 大连商品交易所持仓排名
ak.futures_dce_position_rank(symbol="铁矿石", date="20240101")

# 上海期货交易所持仓排名
ak.futures_shfe_position_rank(symbol="铜", date="20240101")

# 郑州商品交易所持仓排名
ak.futures_czce_position_rank(symbol="甲醇", date="20240101")

# 中国金融期货交易所持仓排名
ak.futures_cffex_position_rank(symbol="沪深300", date="20240101")
```

## 基础信息

```python
# 期货合约信息-新浪
ak.futures_contract_info_sina()

# 期货合约详情-东财
ak.futures_contract_detail(symbol="rb2410")

# 期货品种代码表（外盘）
ak.futures_foreign_commodity_subscribe_exchange_symbol()

# 期货交易日历
ak.tool_trade_date_hist_sina()

# 中证商品指数
ak.futures_index_ccidx(symbol="南华综合指数")
```

## 仓单与交割

```python
# 上期所仓单
ak.futures_shfe_warehouse_receipt()

# 大商所仓单
ak.futures_dce_warehouse_receipt(symbol="铁矿石")

# 郑商所仓单
ak.futures_czce_warehouse_receipt(date="20240101")

# 期转现-大商所
ak.futures_dce_efp()

# 交割统计-大商所
ak.futures_dce_delivery()
```
