# AKShare Data Skill

这是一个基于 [AKShare](https://github.com/akfamily/akshare) 的财经数据查询 Skill，设计用于让大型语言模型 (LLM) 能够按需、精准地获取包含股票、宏观经济、基金、期货、期权、外汇等在内的庞大财经数据。

## 核心设计思路

AKShare 包含超过 500 个数据接口，如果不加以组织，会让 LLM 在每次对话时承受极大的上下文压力。本 Skill 采用了 **统一接口 + 领域路由分发** 的架构：

1. **入口统一 (`SKILL.md`)**: LLM 只需要阅读这一个不超过 200 行入口文件。
2. **领域按需加载 (`references/`)**: `SKILL.md` 中定义了领域路由表。例如，当用户提问“查询苹果股票的最新行情”时，LLM 会根据路由表去读取 `references/stock.md` 获取具体的查询函数名称和参数。
3. **执行层统一 (`scripts/akshare_query.py`)**: 所有的底层接口调用方式都具有高度一致性（返回 Pandas DataFrame）。因此所有查询共享同一个 Python 脚本执行调用、参数解析和结果格式化展示。

---

## 目录结构

```text
akshare-data/
├── README.md                   # 本说明文件
├── SKILL.md                    # Skill 入口文件，定义路由表和基本使用方法
├── scripts/
│   └── akshare_query.py        # 核心查询脚本，负责自动安装依赖和调用 AKShare API
└── references/                 # 领域文档库（保存了各领域最常用的数十个核心接口）
    ├── alternative.md          # 另类数据（各大平台热搜、新闻、空气质量、票房等）
    ├── bond.md                 # 债券数据（国债、可转债、回购等）
    ├── forex.md                # 外汇数据（包含各类货币对及中间价）
    ├── fund.md                 # 基金数据（ETF、LOF、公募净值）
    ├── futures.md              # 期货数据（内盘外盘、仓单及排名）
    ├── index_data.md           # 指数数据（A股指数及海外各大指数行情）
    ├── macro.md                # 宏观数据（中、美、欧 各类经济指标 如 CPI, GDP）
    ├── options.md              # 期权数据（金融和商品期权）
    └── stock.md                # 股票数据（A股及海外市场行情、财报、资金流向等）
```

---

## 脚本依赖与环境要求

* **环境**: Python 3.7+
* **依赖**: `akshare`, `pandas`
* 脚本 `scripts/akshare_query.py` 在首次执行时，如果检测到环境中未安装 `akshare`，会**自动通过清华镜像源进行安装**，你无需手动配置环境。

## 使用示例 (For LLM / CLI)

通用调用格式：
```bash
python3 scripts/akshare_query.py <函数名> [参数=值] ... [--head N] [--save output.csv]
```

**1. 查询 A 股实时行情前 10 条数据**
```bash
python3 scripts/akshare_query.py stock_zh_a_spot_em --head 10
```

**2. 指定参数查询历史行情数据 (支持传入带等号的参数)**
```bash
python3 scripts/akshare_query.py stock_zh_a_hist symbol=000001 period=daily start_date=20240101 end_date=20241231 adjust=qfq
```

**3. 查询并保存中国宏观 CPI 数据至 CSV 文件**
```bash
python3 scripts/akshare_query.py macro_china_cpi --save china_cpi.csv
```

## 参考与数据来源
所有数据的来源请参考 [AKShare 官方文档](https://akshare.akfamily.xyz/data/index.html)。请注意，受限于数据提供商（如东方财富、新浪财经等）的网络与频率限制，极少部分接口在短时间内请求过快可能会面临 IP 临时限制。
