// volatile 配置字段在设置表单写入后变成读取器（.get()），其余情况是普通值。
export function configValue(config, key) {
  const raw = config?.[key];
  return typeof raw?.get === "function" ? raw.get() : raw;
}
