export const GRADES = ["S", "A", "B", "C", "D", "E", "F", "G"];
export const TRACKS = ["芝", "泥"];
export const DISTANCES = ["短", "英", "中", "长"];
export const STYLES = ["逃", "先", "差", "追"];

export const DEFAULT_ADAPTABILITY = {
  track: { "芝": "S", "泥": "S" },
  dist: { "短": "S", "英": "S", "中": "S", "长": "S" },
  style: { "逃": "S", "先": "S", "差": "S", "追": "S" },
};

const ADAPTABILITY_MULTIPLIERS = {
  S: 1.1,
  A: 1.1,
  B: 0.9,
  C: 0.9,
  D: 0.8,
  E: 0.8,
  F: 0.8,
  G: 0.7,
};

// hint 0..5 对应的现价折扣系数。
// 无切者：1级 10%off、2级 20%、3级 30%、4级 35%、满级(5) 40%。
export const DISCOUNTS_NORMAL = [1, 0.9, 0.8, 0.7, 0.65, 0.6];
// 有切者：整体再便宜一档，最低到 50%off。
export const DISCOUNTS_CUT = [0.9, 0.8, 0.7, 0.6, 0.55, 0.5];

/**
 * 根据"原价 + 画面上显示的现价"反算 Hint 等级与是否切者。
 * 折扣越大 Hint 越高；若比无切者最大折扣还便宜，则判定为切者。
 *
 * @param {number} basePrice 技能原价（DB 中的 p）
 * @param {number} currentPrice OCR 读到的当前需要 PT
 * @param {number} [tolerance] 允许的比值误差（价格取整会有少量偏差）
 * @returns {{hint:number, hasCut:boolean, ratio:number, error:number}|null}
 */
export function inferHintFromPrice(basePrice, currentPrice, tolerance = 0.04) {
  if (!basePrice || basePrice <= 0 || !currentPrice || currentPrice <= 0) return null;
  return inferHintFromDiscountRatio(currentPrice / basePrice, tolerance);
}

/**
 * 已知折扣比值（现价/原价，或 1 - %OFF/100）时反算 Hint 与切者。
 * @param {number} ratio 折扣比值，0.6 表示 40%off
 * @param {number} [tolerance] 允许误差
 * @returns {{hint:number, hasCut:boolean, ratio:number, error:number}|null}
 */
export function inferHintFromDiscountRatio(ratio, tolerance = 0.04) {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1.05) return null;

  let best = null;
  const consider = (table, hasCut) => {
    table.forEach((rate, hint) => {
      const error = Math.abs(ratio - rate);
      if (!best || error < best.error) best = { hint, hasCut, ratio, error };
    });
  };
  consider(DISCOUNTS_NORMAL, false);
  consider(DISCOUNTS_CUT, true);

  if (!best || best.error > tolerance) return null;
  return best;
}

export function conditionType(condition) {
  if (TRACKS.includes(condition)) return "track";
  if (DISTANCES.includes(condition)) return "dist";
  if (STYLES.includes(condition)) return "style";
  return "general";
}

export function conditionMultiplier(condition, adaptability) {
  if (!condition || condition === "通用") return 1;
  const type = conditionType(condition);
  if (type === "general") return 1;
  const grade = adaptability[type]?.[condition];
  return ADAPTABILITY_MULTIPLIERS[grade] ?? 1;
}

export function round1(value) {
  return Math.round(value * 10) / 10;
}

export function round2(value) {
  return Math.round(value * 100) / 100;
}

export function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function calculateSkillRows({
  skills,
  upgradeMap,
  hints,
  hasCut,
  mode,
  adaptability,
}) {
  const discounts = hasCut ? DISCOUNTS_CUT : DISCOUNTS_NORMAL;

  return skills.map((skill) => {
    const hint = hints[skill.n] ?? 0;
    const discountRate = discounts[hint] ?? discounts[0];
    const baseScore = round1(skill.a);
    const adaptabilityScore = round1(
      baseScore
        * conditionMultiplier(skill.c1, adaptability)
        * conditionMultiplier(skill.c2, adaptability),
    );
    const testScore =
      skill.r === "传说" ? adaptabilityScore + 1200 : adaptabilityScore + 400;

    const lowerSkillName = upgradeMap[skill.n];
    let currentPrice;

    if (lowerSkillName) {
      const lowerSkill = skills.find((item) => item.n === lowerSkillName);
      if (lowerSkill) {
        const lowerHint = hints[lowerSkill.n];
        const lowerDiscountRate =
          lowerHint === undefined ? discounts[0] : discounts[lowerHint];
        currentPrice = round1(
          (skill.p - lowerSkill.p) * discountRate
            + lowerSkill.p * lowerDiscountRate,
        );
      } else {
        currentPrice = round1(skill.p * discountRate);
      }
    } else {
      currentPrice = round1(skill.p * discountRate);
    }

    const numerator = mode === "test" ? testScore : adaptabilityScore;
    const costPerformance =
      currentPrice > 0 ? round2(numerator / currentPrice) : 0;

    return {
      name: skill.n,
      rarity: skill.r,
      condition: skill.c,
      evalScore: skill.e,
      totalPT: skill.p,
      testScore,
      adaptabilityScore,
      hint,
      discountRate,
      currentPrice,
      costPerformance,
      source: skill,
    };
  });
}
