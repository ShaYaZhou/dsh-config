// 不用装饰器语法时，Remote(...)(method, context) 只把 addInitializer 收集起来，
// 端点标记要到实例初始化才写到原型。调用方按自己的时机（构造器内或类定义之后）
// 把收集到的 initializer 交回来执行一次，否则 Gateway 找不到远程方法。
export function runInitializers(target, initializers) {
  for (const initialize of initializers) initialize.call(target);
}
