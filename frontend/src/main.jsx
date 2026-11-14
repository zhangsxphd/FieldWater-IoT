import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Routes, Route, Link } from "react-router-dom";
import {
  LayoutDashboard,
  Cpu,
  Activity,
  Database,
  ChartNoAxesCombined,
  Bell,
  Settings,
  Leaf,
  ClipboardList,
} from "lucide-react";
import Overview from "./pages/Overview.jsx";
import Equipment from "./pages/Equipment.jsx";
import DeviceDetail from "./pages/DeviceDetail.jsx";
import Research from "./pages/Research.jsx";
import DataWorkspace from "./pages/DataWorkspace.jsx";
import Diagnostics from "./pages/Diagnostics.jsx";
import { Alarms, Settings as SettingsPage } from "./pages/Operations.jsx";
import { Empty } from "./shared.jsx";
import "./style.css";
const nav = [
  ["/", "数据总览", LayoutDashboard],
  ["/devices", "设备管理", Cpu],
  ["/research", "试验管理", Leaf],
  ["/monitor", "实时监测", Activity],
  ["/history", "历史数据", Database],
  ["/analysis", "数据分析", ChartNoAxesCombined],
  ["/diagnostics", "接收诊断", ClipboardList],
  ["/alarms", "告警管理", Bell],
  ["/settings", "系统设置", Settings],
];
function App() {
  return (
    <>
      <header className="top">
        <Link to="/" className="brand">
          <Leaf size={25} />
          <strong>田水智联</strong>
          <span>FieldWater IoT</span>
        </Link>
        <span className="top-divider" />
        <span className="top-subtitle">农业灌溉研究监测平台</span>
        <div className="top-right">
          <Link to="/diagnostics">接收诊断</Link>
          <Link to="/settings">本地环境</Link>
        </div>
      </header>
      <aside className="sidebar">
        <nav>
          {nav.map(([url, name, Icon]) => (
            <NavLink key={url} to={url} end={url === "/"} aria-label={name}>
              <Icon size={19} />
              <span>{name}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          只显示已验证的有效测量
          <br />
          接收原文独立保留
        </div>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/devices" element={<Equipment />} />
          <Route path="/devices/:id" element={<DeviceDetail />} />
          <Route path="/research" element={<Research />} />
          <Route path="/monitor" element={<DataWorkspace mode="monitor" />} />
          <Route path="/history" element={<DataWorkspace mode="history" />} />
          <Route path="/analysis" element={<DataWorkspace mode="analysis" />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
          <Route path="/alarms" element={<Alarms />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <Empty to="/" action="返回总览">
                页面不存在
              </Empty>
            }
          />
        </Routes>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
