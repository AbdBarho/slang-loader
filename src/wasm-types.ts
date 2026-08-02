interface Handle {
  delete(): void;
}

export interface SlangError {
  type: string;
  result: number;
  message: string;
}

export interface CompileTarget {
  name: string;
  value: number;
}

export interface ProgramLayout extends Handle {
  toJsonObject(): unknown;
}

export interface ComponentType extends Handle {
  link(): ComponentType | null;
  getTargetCode(targetIndex: number): string;
  getEntryPointCode(entryPointIndex: number, targetIndex: number): string;
  getLayout(targetIndex: number): ProgramLayout | null;
}

export interface EntryPoint extends ComponentType {
  getName(): string;
}

export interface SlangModule extends ComponentType {
  getDefinedEntryPointCount(): number;
  getDefinedEntryPoint(index: number): EntryPoint | null;
  findEntryPointByName(name: string): EntryPoint | null;
}

export interface Session extends Handle {
  loadModuleFromSource(source: string, name: string, path: string): SlangModule | null;
  createCompositeComponentType(components: ComponentType[]): ComponentType | null;
}

export interface GlobalSession extends Handle {
  createSession(compileTarget: number): Session | null;
}

export interface SlangWasm {
  getVersionString(): string;
  getCompileTargets(): CompileTarget[];
  getLastError(): SlangError;
  createGlobalSession(): GlobalSession | null;
}
