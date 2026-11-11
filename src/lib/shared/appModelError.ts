/** User-facing summaries never include endpoints, provider payloads or aggregated attempt logs. */
export function appModelErrorSummary(error: string, chinese = true): string {
  if (/model_not_found|unknown provider for model|unknown model|model.*(?:not found|does not exist)/i.test(error)) return chinese
    ? "当前模型不可用，请选择其他模型或检查模型配置。" : "This model is unavailable. Select another model or check its configuration.";
  if (/\b401\b|unauthori[sz]ed|invalid.*(?:key|token)|authentication/i.test(error)) return chinese
    ? "模型服务认证失败，请检查凭据。" : "Model authentication failed. Check the credentials.";
  if (/\b402\b|insufficient|quota exceeded|billing|usage limit|available balance/i.test(error)) return chinese
    ? "模型服务额度不足，请检查账户额度。" : "The model service has insufficient quota. Check the account balance.";
  if (/\b429\b|rate.limit|capacity|overloaded/i.test(error)) return chinese
    ? "模型服务暂时繁忙，本次任务未完成。可以稍后重试。" : "The model service is busy. This task is incomplete; try again later.";
  if (/timed? ?out|timeout|fetch failed|connection|socket|econn|enet|ehost|etimedout|terminated|stream.*(?:closed|ended)/i.test(error)) return chinese
    ? "模型连接中断或请求超时，本次任务未完成。已返回的结果已保留。" : "The model connection was interrupted or timed out. This task is incomplete; returned results are preserved.";
  return chinese ? "本次任务未完成，请展开详情查看原因。" : "This task is incomplete. Expand the details to see the reason.";
}
