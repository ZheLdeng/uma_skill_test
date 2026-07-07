import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clipboard,
  FileImage,
  Loader2,
  Monitor,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Upload,
  X,
} from "lucide-react";
import skills from "./data/skills.json";
import upgradeMap from "./data/upgrade-map.json";
import {
  calculateSkillRows,
  DEFAULT_ADAPTABILITY,
  DISTANCES,
  formatNumber,
  GRADES,
  STYLES,
  TRACKS,
} from "./lib/scoring.js";
import {
  createSkillIndex,
  extractGameState,
  recognizeScreenshot,
} from "./lib/ocr.js";

const SORT_OPTIONS = [
  ["default", "默认"],
  ["costPerformanceDesc", "性价比 ↓"],
  ["costPerformanceAsc", "性价比 ↑"],
  ["evalScoreDesc", "评价分 ↓"],
  ["ptDesc", "PT ↓"],
];

const STATUS_LABELS = {
  "loading tesseract core": "加载 OCR 核心",
  "initializing tesseract": "初始化 OCR",
  "loading language traineddata": "加载日文模型",
  "initializing api": "初始化识别器",
  "recognizing text": "识别文字",
};

const cloneAdaptability = () => JSON.parse(JSON.stringify(DEFAULT_ADAPTABILITY));

const hasRecognizedAptitude = (text) =>
  /(芝|ダート|泥|短距離|マイル|中距離|長距離|逃げ|先行|差し|追込).{0,8}[SABCDEFG]/i.test(text);

function App() {
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const monitorStreamRef = useRef(null);
  const monitorTimerRef = useRef(null);
  const monitorRunningRef = useRef(false);
  const monitorBusyRef = useRef(false);
  const monitorCountRef = useRef(0);
  const [mode, setMode] = useState("scoring");
  const [hasCut, setHasCut] = useState(false);
  const [adaptability, setAdaptability] = useState(cloneAdaptability);
  const [hints, setHints] = useState({});
  const [recognized, setRecognized] = useState([]);
  const [rawText, setRawText] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [monitoring, setMonitoring] = useState(false);
  const [monitorCount, setMonitorCount] = useState(0);
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const [sort, setSort] = useState("costPerformanceDesc");
  const [recognizedOnly, setRecognizedOnly] = useState(false);
  const [ocrState, setOcrState] = useState({ running: false, status: "", progress: 0 });
  const [error, setError] = useState("");

  const skillIndex = useMemo(() => createSkillIndex(skills), []);
  const recognizedNames = useMemo(
    () => new Set(recognized.map((item) => item.name)),
    [recognized],
  );

  const rows = useMemo(() => {
    let next = calculateSkillRows({
      skills,
      upgradeMap,
      hints,
      hasCut,
      mode,
      adaptability,
    });

    if (query.trim()) {
      const needle = query.trim().toLowerCase();
      next = next.filter((row) => row.name.toLowerCase().includes(needle));
    }
    if (rarity !== "all") {
      next = next.filter((row) => row.rarity === rarity);
    }
    if (recognizedOnly) {
      next = next.filter((row) => recognizedNames.has(row.name));
    }

    switch (sort) {
      case "costPerformanceDesc":
        next.sort((a, b) => b.costPerformance - a.costPerformance);
        break;
      case "costPerformanceAsc":
        next.sort((a, b) => a.costPerformance - b.costPerformance);
        break;
      case "evalScoreDesc":
        next.sort((a, b) => b.evalScore - a.evalScore);
        break;
      case "ptDesc":
        next.sort((a, b) => b.totalPT - a.totalPT);
        break;
      default:
        break;
    }
    return next;
  }, [adaptability, hasCut, hints, mode, query, rarity, recognizedNames, recognizedOnly, sort]);

  const applyExtractedState = useCallback((extracted, { replace = false } = {}) => {
    setRawText((current) => {
      if (replace || !current) return extracted.rawText;
      return `${extracted.rawText}\n\n--- 上一轮 ---\n${current}`.slice(0, 12000);
    });

    setRecognized((current) => {
      const merged = new Map(replace ? [] : current.map((item) => [item.name, item]));
      for (const item of extracted.recognizedSkills) {
        const existing = merged.get(item.name);
        if (!existing) {
          merged.set(item.name, item);
          continue;
        }
        merged.set(item.name, {
          ...existing,
          ...item,
          hint: Math.max(existing.hint ?? 0, item.hint ?? 0),
          score: Math.max(existing.score ?? 0, item.score ?? 0),
          confidence: Math.max(existing.confidence ?? 0, item.confidence ?? 0),
        });
      }
      return [...merged.values()].sort((a, b) => b.score - a.score);
    });

    setHints((current) => {
      const merged = replace ? {} : { ...current };
      for (const item of extracted.recognizedSkills) {
        merged[item.name] = Math.max(merged[item.name] ?? 0, item.hint ?? 0);
      }
      return merged;
    });

    if (extracted.hasCut) setHasCut(true);
    if (hasRecognizedAptitude(extracted.rawText)) {
      setAdaptability(extracted.adaptability);
    }
    if (extracted.recognizedSkills.length > 0) {
      setRecognizedOnly(true);
    }
  }, []);

  const handleFiles = useCallback(
    async (fileList) => {
      const file = [...fileList].find((item) => item.type.startsWith("image/"));
      if (!file) return;

      setError("");
      setOcrState({ running: true, status: "准备图片", progress: 0 });

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(file));

      try {
        const { data, numberTokens } = await recognizeScreenshot(file, (next) => {
          setOcrState({
            running: true,
            status: STATUS_LABELS[next.status] ?? next.status,
            progress: next.progress ?? 0,
          });
        });
        const extracted = extractGameState(data, skillIndex, numberTokens);
        applyExtractedState(extracted, { replace: true });
        setOcrState({ running: false, status: "完成", progress: 1 });
      } catch (nextError) {
        setError(nextError?.message ?? "OCR 识别失败");
        setOcrState({ running: false, status: "失败", progress: 0 });
      }
    },
    [applyExtractedState, previewUrl, skillIndex],
  );

  const captureMonitorFrame = useCallback(async () => {
    if (!monitorRunningRef.current || monitorBusyRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return;

    monitorBusyRef.current = true;
    monitorCountRef.current += 1;
    setMonitorCount(monitorCountRef.current);
    setOcrState({ running: true, status: "监控识别中", progress: 0 });

    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const file = new File([blob], `monitor-${Date.now()}.png`, { type: "image/png" });
      const { data, numberTokens } = await recognizeScreenshot(file, (next) => {
        setOcrState({
          running: true,
          status: STATUS_LABELS[next.status] ?? next.status,
          progress: next.progress ?? 0,
        });
      });
      const extracted = extractGameState(data, skillIndex, numberTokens);
      applyExtractedState(extracted, { replace: false });
      setOcrState({
        running: false,
        status: `监控中，已扫描 ${monitorCountRef.current} 次`,
        progress: 1,
      });
    } catch (nextError) {
      setError(nextError?.message ?? "监控 OCR 失败");
      setOcrState({ running: false, status: "监控识别失败", progress: 0 });
    } finally {
      monitorBusyRef.current = false;
    }
  }, [applyExtractedState, skillIndex]);

  const stopMonitoring = useCallback(() => {
    monitorRunningRef.current = false;
    setMonitoring(false);
    if (monitorTimerRef.current) {
      clearInterval(monitorTimerRef.current);
      monitorTimerRef.current = null;
    }
    if (monitorStreamRef.current) {
      for (const track of monitorStreamRef.current.getTracks()) track.stop();
      monitorStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setOcrState((current) => ({
      running: false,
      status: current.status.startsWith("监控") ? "监控已停止" : current.status,
      progress: current.progress,
    }));
  }, []);

  const startMonitoring = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("当前浏览器不支持窗口监控，请使用 Chrome / Edge");
      return;
    }

    try {
      setError("");
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 2,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      monitorStreamRef.current = stream;
      monitorRunningRef.current = true;
      monitorCountRef.current = 0;
      setMonitorCount(0);
      setMonitoring(true);
      setRecognizedOnly(true);

      const video = videoRef.current;
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      stream.getVideoTracks()[0]?.addEventListener("ended", stopMonitoring, { once: true });

      await captureMonitorFrame();
      monitorTimerRef.current = setInterval(captureMonitorFrame, 4500);
    } catch (nextError) {
      if (nextError?.name !== "NotAllowedError") {
        setError(nextError?.message ?? "无法开始窗口监控");
      }
      stopMonitoring();
    }
  }, [captureMonitorFrame, stopMonitoring]);

  useEffect(() => stopMonitoring, [stopMonitoring]);

  const handlePaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((candidate) => candidate.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          await handleFiles([new File([blob], "clipboard.png", { type })]);
          return;
        }
      }
      setError("剪贴板里没有图片");
    } catch {
      setError("浏览器没有开放剪贴板图片权限");
    }
  }, [handleFiles]);

  const updateAdaptability = (group, key, value) => {
    setAdaptability((current) => ({
      ...current,
      [group]: { ...current[group], [key]: value },
    }));
  };

  const updateHint = (name, value) => {
    const parsed = Number.parseInt(value, 10);
    setHints((current) => {
      const next = { ...current };
      if (Number.isNaN(parsed)) {
        delete next[name];
      } else {
        next[name] = Math.min(5, Math.max(0, parsed));
      }
      return next;
    });
  };

  const reset = () => {
    setHints({});
    setRecognized([]);
    setRawText("");
    setHasCut(false);
    setAdaptability(cloneAdaptability());
    setRecognizedOnly(false);
    setError("");
    setMonitorCount(0);
    monitorCountRef.current = 0;
  };

  return (
    <main className="app">
      <section className="topbar">
        <div>
          <h1>赛马娘 OCR 凹分工具</h1>
          <p>技能 {skills.length} 个，当前结果 {rows.length} 个</p>
        </div>
        <div className="top-actions">
          <button
            className={`button ${monitoring ? "danger" : "secondary"}`}
            onClick={monitoring ? stopMonitoring : startMonitoring}
            type="button"
          >
            {monitoring ? <Square size={15} /> : <Monitor size={16} />}
            {monitoring ? "停止监控" : "监控窗口"}
          </button>
          <button className="button secondary" onClick={handlePaste} type="button">
            <Clipboard size={16} />
            粘贴截图
          </button>
          <button
            className="button primary"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <Upload size={16} />
            上传截图
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => handleFiles(event.target.files)}
          />
        </div>
      </section>

      <section className="workspace">
        <div
          className="panel dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            handleFiles(event.dataTransfer.files);
          }}
        >
          <div className="panel-title">
            <FileImage size={17} />
            截图 OCR
          </div>
          <div className="preview">
            <video
              ref={videoRef}
              className={monitoring ? "" : "hidden"}
              playsInline
              muted
            />
            <canvas ref={canvasRef} hidden />
            {!monitoring && previewUrl ? (
              <img src={previewUrl} alt="uploaded screenshot preview" />
            ) : !monitoring ? (
              <FileImage size={42} />
            ) : null}
          </div>
          <div className="ocr-status">
            {ocrState.running ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Sparkles size={16} />
            )}
            <span>{ocrState.status || "等待截图"}</span>
            <strong>{Math.round((ocrState.progress ?? 0) * 100)}%</strong>
          </div>
          <div className="progress">
            <span style={{ width: `${Math.round((ocrState.progress ?? 0) * 100)}%` }} />
          </div>
          {error && (
            <div className="error">
              <X size={14} />
              {error}
            </div>
          )}
          <div className="recognized-list">
            {recognized.slice(0, 12).map((item) => (
              <button
                key={item.name}
                className="recognized-chip"
                title={item.sourceText}
                type="button"
                onClick={() => setQuery(item.name)}
              >
                <span>{item.name}</span>
                <b>Lv{item.hint ?? 0}</b>
              </button>
            ))}
          </div>
          {monitoring && (
            <div className="monitor-note">
              已扫描 {monitorCount} 次，识别到 {recognized.length} 个技能
            </div>
          )}
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            placeholder="OCR 原文"
          />
        </div>

        <div className="panel controls">
          <div className="panel-title">
            <Sparkles size={17} />
            参数
          </div>

          <div className="control-row">
            <span>切者</span>
            <div className="segmented two">
              <button
                className={!hasCut ? "active" : ""}
                onClick={() => setHasCut(false)}
                type="button"
              >
                0
              </button>
              <button
                className={hasCut ? "active" : ""}
                onClick={() => setHasCut(true)}
                type="button"
              >
                1
              </button>
            </div>
          </div>

          <div className="control-row">
            <span>模式</span>
            <div className="segmented">
              <button
                className={mode === "test" ? "active" : ""}
                onClick={() => setMode("test")}
                type="button"
              >
                技能测验
              </button>
              <button
                className={mode === "scoring" ? "active" : ""}
                onClick={() => setMode("scoring")}
                type="button"
              >
                凹分
              </button>
            </div>
          </div>

          <AptitudeGroup
            title="场地"
            group="track"
            labels={TRACKS}
            values={adaptability.track}
            onChange={updateAdaptability}
          />
          <AptitudeGroup
            title="距离"
            group="dist"
            labels={DISTANCES}
            values={adaptability.dist}
            onChange={updateAdaptability}
          />
          <AptitudeGroup
            title="脚质"
            group="style"
            labels={STYLES}
            values={adaptability.style}
            onChange={updateAdaptability}
          />

          <div className="toolbar">
            <div className="searchbox">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索技能名"
              />
            </div>
            <select value={rarity} onChange={(event) => setRarity(event.target.value)}>
              <option value="all">全部</option>
              <option value="普通">普通</option>
              <option value="传说">传说</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {SORT_OPTIONS.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={recognizedOnly}
                onChange={(event) => setRecognizedOnly(event.target.checked)}
              />
              已识别
            </label>
            <button className="button ghost" onClick={reset} type="button">
              <RotateCcw size={15} />
              重置
            </button>
          </div>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>技能名</th>
                <th>稀有</th>
                <th>条件</th>
                <th>评价分</th>
                <th>原价</th>
                <th>{mode === "test" ? "技能测验分" : "适性评价分"}</th>
                <th>Hint</th>
                <th>现价</th>
                <th>{mode === "test" ? "性价比" : "性价比（凹分）"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.name}
                  className={[
                    recognizedNames.has(row.name) ? "detected" : "",
                    row.rarity === "传说" ? "legend" : "",
                    row.name.endsWith("◎") ? "double-circle" : "",
                  ].join(" ")}
                >
                  <td className="skill-name">{row.name}</td>
                  <td>{row.rarity}</td>
                  <td>{row.condition}</td>
                  <td className="num">{row.evalScore}</td>
                  <td className="num">{row.totalPT}</td>
                  <td className="num">
                    {mode === "test" ? row.testScore : formatNumber(row.adaptabilityScore)}
                  </td>
                  <td>
                    <input
                      className="hint-input"
                      type="number"
                      min="0"
                      max="5"
                      value={hints[row.name] ?? ""}
                      placeholder="0"
                      onChange={(event) => updateHint(row.name, event.target.value)}
                    />
                  </td>
                  <td className="num">{formatNumber(row.currentPrice)}</td>
                  <td className="num score">{row.costPerformance.toFixed(2)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan="9" className="empty">
                    没有匹配的技能
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function AptitudeGroup({ title, group, labels, values, onChange }) {
  return (
    <div className="aptitude-group">
      <div className="group-label">{title}</div>
      <div className="aptitude-grid">
        {labels.map((label) => (
          <label className="grade-field" key={label}>
            <span>{label}</span>
            <select
              value={values[label]}
              onChange={(event) => onChange(group, label, event.target.value)}
            >
              {GRADES.map((grade) => (
                <option value={grade} key={grade}>
                  {grade}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

export default App;
