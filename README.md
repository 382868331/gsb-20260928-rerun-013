# 数字电路设计平台

Python 标准库提供事件驱动仿真和电路持久化，React + Vite 提供逻辑元件连线界面、输入事件编辑、波形和诊断显示。

## 启动

```bash
cd backend
python3 app.py
```

```bash
cd frontend
npm install
npm run dev
```

打开 Vite 输出的地址（默认 `http://localhost:5173`）。

## 已实现

- 元件：`INPUT`、`NOT`、`BUFFER`、`AND`、`OR`、`XOR`、`NAND`、`NOR`、`XNOR`。
- 每个逻辑元件有独立传播延迟；仿真使用按时间排序的事件队列，不做一次性静态求值。
- 支持反馈环；队列清空为稳定，观测窗口后仍有未来事件为持续振荡。
- 未连接输入按 `X` 传播；多个输出连接到同一输入端口发生争用并显示诊断。
- 内置组合延迟、NAND 锁存器、NOT 振荡器、断连/争用示例。
- 电路和输入事件保存到 `backend/circuits.json`，可重新载入并重新运行。
- 修改电路、激励、观测窗口或撤销/重做都会产生新修订并清空旧结果；运行响应同时校验运行代次、修订号和电路/激励 SHA-256 指纹。
- 可保存一份结果为对照，在修改单个门延迟或一条连线后叠加两份波形，并显示传播差异、振荡、争用和稳定状态变化。

## 测试

```bash
cd backend
python3 -m pytest -q
cd ../frontend
npx tsc --noEmit
npm run build
```
