import { parseSupervisorDecision } from './delegation-parser';

describe('parseSupervisorDecision（委派解析容错）', () => {
  it('解析合法委派 JSON', () => {
    const d = parseSupervisorDecision('{"delegate":"coder","subtask":"写代码"}');
    expect(d.parsed).toBe(true);
    expect(d.finish).toBe(false);
    expect(d.delegate).toBe('coder');
    expect(d.subtask).toBe('写代码');
  });

  it('解析被 markdown 代码块包裹的 JSON', () => {
    const d = parseSupervisorDecision('```json\n{"finish":true,"summary":"完成"}\n```');
    expect(d.parsed).toBe(true);
    expect(d.finish).toBe(true);
    expect(d.summary).toBe('完成');
  });

  it('解析前后带自然语言的 JSON', () => {
    const d = parseSupervisorDecision('好的，我来委派：\n{"delegate":["a","b"],"subtask":"并行"}\n请加油');
    expect(d.parsed).toBe(true);
    expect(Array.isArray(d.delegate)).toBe(true);
    expect((d.delegate as string[])).toEqual(['a', 'b']);
  });

  it('TR-7.1 非法 / 非 JSON 输出降级为 finish 且 parsed=false', () => {
    const d = parseSupervisorDecision('我觉得应该先讨论一下，不输出 JSON');
    expect(d.parsed).toBe(false);
    expect(d.finish).toBe(true);
  });

  it('空输出降级 parsed=false', () => {
    expect(parseSupervisorDecision('').parsed).toBe(false);
    expect(parseSupervisorDecision('   ').parsed).toBe(false);
  });

  it('兼容字段名 worker/to 与 task', () => {
    expect(parseSupervisorDecision('{"worker":"x","task":"y"}').delegate).toBe('x');
    expect(parseSupervisorDecision('{"to":"x","instruction":"y"}').subtask).toBe('y');
  });
});
