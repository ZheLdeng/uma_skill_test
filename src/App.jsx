import React, { useMemo, useState } from "react";
import { Plus, RotateCcw, Search, Sparkles, X } from "lucide-react";
import skills from "./data/skills.json";
import upgradeMap from "./data/upgrade-map.json";
import supportCards from "./data/support-cards.json";
import skillCn from "./data/skill-cn.json";
import umaList from "./data/uma.json";

const MAX_DECK = 6;
const cardImage = (id) =>
  `https://gametora.com/images/umamusume/supports/support_card_s_${id}.png`;
const umaThumb = (id) =>
  `https://gametora.com/images/umamusume/characters/thumb/chara_stand_${String(id).slice(0, 4)}_${id}.png`;
const umaIcon = (charId) =>
  `https://gametora.com/images/umamusume/characters/icons/chr_icon_${charId}.png`;
const cnOf = (name) => skillCn[name] ?? "";
const hideImg = (e) => {
  e.currentTarget.style.display = "none";
};
import {
  calculateSkillRows,
  DEFAULT_ADAPTABILITY,
  DISTANCES,
  formatNumber,
  GRADES,
  STYLES,
  TRACKS,
} from "./lib/scoring.js";

const SORT_OPTIONS = [
  ["default", "默认"],
  ["costPerformanceDesc", "性价比 ↓"],
  ["costPerformanceAsc", "性价比 ↑"],
  ["evalScoreDesc", "评价分 ↓"],
  ["ptDesc", "PT ↓"],
];

const CARD_TYPE_LABELS = {
  speed: "速度",
  stamina: "耐力",
  power: "力量",
  guts: "根性",
  intelligence: "智力",
  friend: "友人",
  group: "团队",
};

const CARD_RARITY_LABELS = { 3: "SSR", 2: "SR", 1: "R" };

const cloneAdaptability = () => JSON.parse(JSON.stringify(DEFAULT_ADAPTABILITY));

function App() {
  const [mode, setMode] = useState("scoring");
  const [hasCut, setHasCut] = useState(false);
  const [adaptability, setAdaptability] = useState(cloneAdaptability);
  const [hints, setHints] = useState({});

  const [selectedUmaId, setSelectedUmaId] = useState(null);
  const [umaQuery, setUmaQuery] = useState("");
  const [deck, setDeck] = useState([]); // 选中的支援卡 id
  const [manualSkills, setManualSkills] = useState([]); // 手动添加的技能名
  const [cardQuery, setCardQuery] = useState("");
  const [cardType, setCardType] = useState("all");
  const [cardRarity, setCardRarity] = useState("all");
  const [skillQuery, setSkillQuery] = useState("");

  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const [sort, setSort] = useState("costPerformanceDesc");
  const [ownedOnly, setOwnedOnly] = useState(true);

  const cardById = useMemo(() => new Map(supportCards.map((c) => [c.id, c])), []);
  const skillNameSet = useMemo(() => new Set(skills.map((s) => s.n)), []);

  const selectedCards = useMemo(
    () => deck.map((id) => cardById.get(id)).filter(Boolean),
    [cardById, deck],
  );

  const selectedUma = useMemo(
    () => umaList.find((u) => u.id === selectedUmaId) ?? null,
    [selectedUmaId],
  );

  const umaSkillNames = useMemo(
    () => new Set(selectedUma?.skills ?? []),
    [selectedUma],
  );

  const cardSkillNames = useMemo(() => {
    const set = new Set();
    for (const card of selectedCards) for (const name of card.skills) set.add(name);
    return set;
  }, [selectedCards]);

  const umaResults = useMemo(() => {
    const needle = umaQuery.trim();
    if (!needle) return umaList.slice(0, 40);
    return umaList
      .filter(
        (u) => u.name.includes(needle) || u.char.includes(needle) || (u.charCn && u.charCn.includes(needle)),
      )
      .slice(0, 40);
  }, [umaQuery]);

  const ownedSkillNames = useMemo(() => {
    const owned = new Set(manualSkills);
    for (const card of selectedCards) {
      for (const name of card.skills) owned.add(name);
    }
    for (const name of umaSkillNames) owned.add(name);
    return owned;
  }, [manualSkills, selectedCards, umaSkillNames]);

  // 技能 -> 提供它的已选支援卡（用于"来源"列显示卡头像）
  const skillToCards = useMemo(() => {
    const map = new Map();
    for (const card of selectedCards) {
      for (const name of card.skills) {
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(card);
      }
    }
    return map;
  }, [selectedCards]);

  const cardResults = useMemo(() => {
    const needle = cardQuery.trim();
    let list = supportCards;
    if (cardType !== "all") list = list.filter((c) => c.type === cardType);
    if (cardRarity !== "all") list = list.filter((c) => c.rarity === Number(cardRarity));
    if (needle) {
      list = list.filter(
        (c) =>
          c.name.includes(needle) ||
          c.char.includes(needle) ||
          (c.nameCn && c.nameCn.includes(needle)) ||
          (c.charCn && c.charCn.includes(needle)),
      );
    }
    return list.slice(0, 60);
  }, [cardQuery, cardType, cardRarity]);

  const skillResults = useMemo(() => {
    const needle = skillQuery.trim();
    if (!needle) return [];
    const lower = needle.toLowerCase();
    return skills
      .filter(
        (s) =>
          !ownedSkillNames.has(s.n) &&
          (s.n.includes(needle) || cnOf(s.n).includes(needle) || cnOf(s.n).toLowerCase().includes(lower)),
      )
      .slice(0, 20);
  }, [ownedSkillNames, skillQuery]);

  const rows = useMemo(() => {
    let next = calculateSkillRows({ skills, upgradeMap, hints, hasCut, mode, adaptability });

    if (query.trim()) {
      const needle = query.trim();
      next = next.filter((row) => row.name.includes(needle));
    }
    if (rarity !== "all") next = next.filter((row) => row.rarity === rarity);
    if (ownedOnly) next = next.filter((row) => ownedSkillNames.has(row.name));

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
  }, [adaptability, hasCut, hints, mode, ownedOnly, ownedSkillNames, query, rarity, sort]);

  const toggleCard = (id) =>
    setDeck((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (current.length >= MAX_DECK) return current;
      return [...current, id];
    });

  const selectUma = (uma) => {
    if (selectedUmaId === uma.id) {
      setSelectedUmaId(null);
      return;
    }
    setSelectedUmaId(uma.id);
    if (uma.aptitude) setAdaptability(JSON.parse(JSON.stringify(uma.aptitude)));
  };

  const addManualSkill = (name) => {
    setManualSkills((current) => (current.includes(name) ? current : [...current, name]));
    setSkillQuery("");
  };
  const removeManualSkill = (name) =>
    setManualSkills((current) => current.filter((x) => x !== name));

  const updateAdaptability = (group, key, value) =>
    setAdaptability((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));

  const updateHint = (name, value) => {
    const parsed = Number.parseInt(value, 10);
    setHints((current) => {
      const next = { ...current };
      if (Number.isNaN(parsed)) delete next[name];
      else next[name] = Math.min(5, Math.max(0, parsed));
      return next;
    });
  };

  const reset = () => {
    setSelectedUmaId(null);
    setDeck([]);
    setManualSkills([]);
    setHints({});
    setHasCut(false);
    setAdaptability(cloneAdaptability());
  };

  // 清空当前结果表里所有技能的 Hint
  const clearAllHint = () => {
    setHints((current) => {
      const next = { ...current };
      for (const row of rows) delete next[row.name];
      return next;
    });
  };

  // 把当前结果表里、名字属于 nameSet 的技能设为某 Hint 等级
  const setHintForNames = (nameSet, level) => {
    setHints((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (nameSet.has(row.name)) next[row.name] = level;
      }
      return next;
    });
  };

  return (
    <main className="app">
      <section className="topbar">
        <div>
          <h1>赛马娘凹分工具</h1>
          <p>
            马娘 {umaList.length} · 支援卡 {supportCards.length} · 技能 {skills.length} · 持有 {ownedSkillNames.size} · 结果 {rows.length}
          </p>
        </div>
        <button className="button ghost" onClick={reset} type="button">
          <RotateCcw size={15} />
          重置
        </button>
      </section>

      <section className="workspace">
        <div className="panel deck-panel">
          <div className="panel-title">
            <Sparkles size={17} />
            马娘
          </div>

          {selectedUma && (
            <div className="uma-selected">
              <img className="uma-thumb" src={umaThumb(selectedUma.id)} alt="" onError={hideImg} />
              <div className="uma-info">
                <div className="uma-name">{selectedUma.charCn || selectedUma.char}</div>
                <div className="uma-sub">{selectedUma.name}</div>
                {selectedUma.unique && (
                  <div className="uma-unique" title={selectedUma.unique.name}>
                    固有：{selectedUma.unique.nameCn || selectedUma.unique.name}
                  </div>
                )}
              </div>
              <button className="button ghost icon-btn" onClick={() => setSelectedUmaId(null)} type="button">
                <X size={14} />
              </button>
            </div>
          )}

          <div className="searchbox">
            <Search size={15} />
            <input
              value={umaQuery}
              onChange={(event) => setUmaQuery(event.target.value)}
              placeholder="搜索马娘（中/日名），选中自动带入适性与自带技能"
            />
          </div>
          <div className="uma-grid">
            {umaResults.map((uma) => (
              <button
                key={uma.id}
                className={`uma-avatar ${selectedUmaId === uma.id ? "active" : ""}`}
                onClick={() => selectUma(uma)}
                title={`${uma.charCn || uma.char}｜${uma.name}`}
                type="button"
              >
                <img src={umaThumb(uma.id)} alt={uma.charCn || uma.char} loading="lazy" onError={hideImg} />
              </button>
            ))}
          </div>

          <div className="panel-title with-sep">
            <Sparkles size={17} />
            支援卡编成
            <span className="deck-count">{deck.length} / {MAX_DECK} 张</span>
          </div>

          {selectedCards.length > 0 && (
            <div className="deck-chips">
              {selectedCards.map((card) => (
                <button
                  key={card.id}
                  className={`deck-chip type-${card.type}`}
                  onClick={() => toggleCard(card.id)}
                  title={`${card.nameCn ? `${card.nameCn} / ` : ""}${card.name}（${card.skills.length} 个技能）`}
                  type="button"
                >
                  <img
                    className="chip-img"
                    src={cardImage(card.id)}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                  <span className="chip-name">{card.charCn || card.char}</span>
                  <X size={13} />
                </button>
              ))}
            </div>
          )}

          <div className="card-filters">
            <div className="searchbox">
              <Search size={15} />
              <input
                value={cardQuery}
                onChange={(event) => setCardQuery(event.target.value)}
                placeholder="搜索支援卡（名字/角色）"
              />
            </div>
            <select value={cardType} onChange={(event) => setCardType(event.target.value)}>
              <option value="all">全部类型</option>
              {Object.entries(CARD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select value={cardRarity} onChange={(event) => setCardRarity(event.target.value)}>
              <option value="all">全部稀有</option>
              <option value="3">SSR</option>
              <option value="2">SR</option>
              <option value="1">R</option>
            </select>
          </div>

          {deck.length >= MAX_DECK && <div className="deck-full">已选满 {MAX_DECK} 张，需先移除再添加</div>}

          <div className="card-list">
            {cardResults.map((card) => {
              const active = deck.includes(card.id);
              const full = !active && deck.length >= MAX_DECK;
              return (
                <button
                  key={card.id}
                  className={`card-row type-${card.type} ${active ? "active" : ""} ${full ? "disabled" : ""}`}
                  onClick={() => toggleCard(card.id)}
                  disabled={full}
                  type="button"
                >
                  <img
                    className="card-img"
                    src={cardImage(card.id)}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                  <span className="card-rarity">{CARD_RARITY_LABELS[card.rarity] ?? ""}</span>
                  <span className="card-type">{CARD_TYPE_LABELS[card.type] ?? card.type}</span>
                  <span className="card-names">
                    <span className="card-name-cn" title={card.name}>{card.charCn || card.char}</span>
                    {card.charCn && card.charCn !== card.char && (
                      <span className="card-name-jp">{card.char}</span>
                    )}
                  </span>
                  <span className="card-skillcount">{card.skills.length} 技能</span>
                  {active ? <X size={14} /> : <Plus size={14} />}
                </button>
              );
            })}
            {!cardResults.length && <div className="empty">没有匹配的支援卡</div>}
          </div>

          <div className="panel-subtitle">手动添加技能</div>
          <div className="searchbox">
            <Search size={15} />
            <input
              value={skillQuery}
              onChange={(event) => setSkillQuery(event.target.value)}
              placeholder="搜索技能名后点击添加"
            />
          </div>
          {skillResults.length > 0 && (
            <div className="skill-suggest">
              {skillResults.map((skill) => (
                <button
                  key={skill.n}
                  className="suggest-item"
                  onClick={() => addManualSkill(skill.n)}
                  type="button"
                >
                  <Plus size={13} />
                  <span className="suggest-name">
                    {skill.n}
                    {cnOf(skill.n) && <em className="suggest-cn">{cnOf(skill.n)}</em>}
                  </span>
                  <span className="suggest-meta">{skill.r}</span>
                </button>
              ))}
            </div>
          )}
          {manualSkills.length > 0 && (
            <div className="manual-chips">
              {manualSkills.map((name) => (
                <button
                  key={name}
                  className="manual-chip"
                  onClick={() => removeManualSkill(name)}
                  title={cnOf(name) ? `${cnOf(name)} / ${name}` : name}
                  type="button"
                >
                  {cnOf(name) || name}
                  <X size={12} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel controls">
          <div className="panel-title">
            <Sparkles size={17} />
            参数
          </div>

          <div className="control-row">
            <span>切者</span>
            <div className="segmented two">
              <button className={!hasCut ? "active" : ""} onClick={() => setHasCut(false)} type="button">
                0
              </button>
              <button className={hasCut ? "active" : ""} onClick={() => setHasCut(true)} type="button">
                1
              </button>
            </div>
          </div>

          <div className="control-row">
            <span>模式</span>
            <div className="segmented">
              <button className={mode === "test" ? "active" : ""} onClick={() => setMode("test")} type="button">
                技能测验
              </button>
              <button className={mode === "scoring" ? "active" : ""} onClick={() => setMode("scoring")} type="button">
                凹分
              </button>
            </div>
          </div>

          <AptitudeGroup title="场地" group="track" labels={TRACKS} values={adaptability.track} onChange={updateAdaptability} />
          <AptitudeGroup title="距离" group="dist" labels={DISTANCES} values={adaptability.dist} onChange={updateAdaptability} />
          <AptitudeGroup title="脚质" group="style" labels={STYLES} values={adaptability.style} onChange={updateAdaptability} />

          <div className="toolbar">
            <div className="searchbox">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="过滤结果技能名" />
            </div>
            <select value={rarity} onChange={(event) => setRarity(event.target.value)}>
              <option value="all">全部</option>
              <option value="普通">白技能</option>
              <option value="传说">金技能</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              {SORT_OPTIONS.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            <label className="checkbox">
              <input type="checkbox" checked={ownedOnly} onChange={(event) => setOwnedOnly(event.target.checked)} />
              仅持有
            </label>
            <button className="button secondary" onClick={() => setHintForNames(cardSkillNames, 5)} type="button">
              支援卡 Hint5
            </button>
            <button className="button secondary" onClick={() => setHintForNames(umaSkillNames, 3)} type="button">
              马娘自带 Hint3
            </button>
            <button className="button ghost" onClick={clearAllHint} type="button">
              清空 Hint
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
                <th>来源</th>
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
                    ownedSkillNames.has(row.name) ? "detected" : "",
                    row.rarity === "传说" ? "legend" : "",
                    row.name.endsWith("◎") ? "double-circle" : "",
                  ].join(" ")}
                >
                  <td className={`skill-name ${row.rarity === "传说" ? "gold" : ""}`}>
                    {row.name}
                    {cnOf(row.name) && <span className="skill-cn">{cnOf(row.name)}</span>}
                  </td>
                  <td className="source-cell">
                    {selectedUma && umaSkillNames.has(row.name) && (
                      <img
                        className="source-img uma"
                        src={umaIcon(selectedUma.charId)}
                        alt=""
                        title={selectedUma.charCn || selectedUma.char}
                        loading="lazy"
                        onError={hideImg}
                      />
                    )}
                    {(skillToCards.get(row.name) ?? []).map((card) => (
                      <img
                        key={card.id}
                        className="source-img"
                        src={cardImage(card.id)}
                        alt=""
                        title={card.charCn || card.char}
                        loading="lazy"
                        onError={hideImg}
                      />
                    ))}
                  </td>
                  <td>
                    <span className={`rarity-tag ${row.rarity === "传说" ? "gold" : "white"}`}>
                      {row.rarity === "传说" ? "金" : "白"}
                    </span>
                  </td>
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
                  <td colSpan="10" className="empty">
                    {ownedOnly ? "先选支援卡或手动添加技能" : "没有匹配的技能"}
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
            <select value={values[label]} onChange={(event) => onChange(group, label, event.target.value)}>
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
