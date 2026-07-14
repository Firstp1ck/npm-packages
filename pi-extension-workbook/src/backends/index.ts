export { OoxmlSafeEngine, OOXML_CAPABILITIES } from "./ooxml-safe.ts";
export { NativeExcelCandidate, runNativeExcelWorker } from "./excel-native.ts";
export { probeAllBackends, probeAspose, probeNativeExcel } from "./probes.ts";
export { selectMutationBackend } from "./selector.ts";
export type { WorkbookEngine, EngineCapabilities, WorkbookBackendId } from "../contracts.ts";
