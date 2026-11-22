// 主管委派决策的结构化输出解析（Task 7 / AC-15）。
// 容错：模型输出可能被 markdown 代码块包裹、前后带自然语言、JSON 非法等。
// 解析失败时返回 parsed:false 的降级结果，由主管节点重试一次后结束。

import type { SupervisorDecision } from './types.js';

/**
 * 从主管模型输出中提取委派 JSON。
 * 支持：纯 JSON、```json 包裹、前后有解释文字、字段名轻微差异（worker/to/task）。
 */
export function parseSupervisorDecision(raw: string): SupervisorDecision {
  const text = String(raw ?? '').trim();
  if (!text) {
    return { finish: true, summary: '', parsed: false, raw };
  }

  // 去掉 markdown 代码围栏（```json ... ``` 或 ``` ... ```）
  const noFences = text.replace(/```(?:json|JSON)?/g, '').trim();

  // 提取第一个 {...} 块（贪婪匹配到最后一个 }，兼容嵌套）
  const match = noFences.match(/\{[\s\S]*\}/);
  const candidate = match ? match[0] : noFences;

  let obj: any = null;
  try {
    obj = JSON.parse(candidate);
  } catch {
    // 尝试修复常见问题：去掉尾随逗号、单引号转双引号
    try {
      const repaired = candidate
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/'/g, '"');
      obj = JSON.parse(repaired);
    } catch {
      obj = null;
    }
  }

  if (obj && typeof obj === 'object') {
    // 结束决策
    if (obj.finish === true || obj.finish === 'true' || obj.done === true) {
      return {
        finish: true,
        summary: typeof obj.summary === 'string' ? obj.summary : '',
        parsed: true,
        raw,
      };
    }
    // 委派决策
    const delegate = obj.delegate ?? obj.worker ?? obj.to ?? obj.assign;
    if (delegate) {
      const delegates = Array.isArray(delegate)
        ? delegate.map((d: any) => String(d).trim()).filter(Boolean)
        : [String(delegate).trim()].filter(Boolean);
      if (delegates.length > 0) {
        const subtask = obj.subtask ?? obj.task ?? obj.instruction ?? '';
        return {
          finish: false,
          delegate: delegates.length === 1 ? delegates[0] : delegates,
          subtask: String(subtask ?? ''),
          parsed: true,
          raw,
        };
      }
    }
  }

  // 无法解析 → 降级 finish，parsed:false 触发重试
  return { finish: true, summary: '', parsed: false, raw };
}
