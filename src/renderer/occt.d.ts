declare module 'occt-import-js' {
  const occtimportjs: (options?: object) => Promise<unknown>;
  export default occtimportjs;
}
declare module '*?url' {
  const url: string;
  export default url;
}
declare module '*?worker&inline' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
