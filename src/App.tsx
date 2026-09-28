import { ElectionProfile } from "./components/ElectionProfile";
import { SystemValidator } from "./components/SystemValidator";
import { PipelineRunner } from "./components/PipelineRunner";

export default function App() {
  return <>
    <ElectionProfile />
    <SystemValidator />
    <PipelineRunner />
  </>;
}
