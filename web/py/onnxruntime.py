"""Mažas onnxruntime pakaitalas naršyklei.

homr kviečia onnxruntime (InferenceSession, io_binding, OrtValue). Naršyklėje modelius
vykdo ONNX Runtime Web (JavaScript), todėl čia tie patys pavadinimai perduoda darbą į JS.
JS funkcijos grąžina Promise, o Python kodas jų laukia sinchroniškai per run_sync
(JavaScript Promise Integration, palaiko Chrome, Edge ir naujausias Firefox).

Įgyvendinta tik tai, ką naudoja homr.
"""

from __future__ import annotations

import os

import js
import numpy as np
from pyodide.ffi import run_sync, to_js

_NP_TO_ORT = {
    np.dtype("float32"): "float32",
    np.dtype("float16"): "float16",
    np.dtype("float64"): "float64",
    np.dtype("int64"): "int64",
    np.dtype("int32"): "int32",
    np.dtype("int8"): "int8",
    np.dtype("uint8"): "uint8",
    np.dtype("bool"): "bool",
}
_ORT_TO_NP = {v: k for k, v in _NP_TO_ORT.items()}


def get_available_providers() -> list[str]:
    return ["CPUExecutionProvider"]


def get_device() -> str:
    return "CPU"


def set_default_logger_severity(level: int) -> None:
    pass


def preload_dlls(*args, **kwargs) -> None:
    pass


class SessionOptions:
    def __init__(self) -> None:
        pass


class _NodeArg:
    def __init__(self, name: str) -> None:
        self.name = name


def _to_js_tensor(arr: np.ndarray):
    arr = np.ascontiguousarray(arr)
    if arr.dtype not in _NP_TO_ORT:
        arr = arr.astype(np.float32)
    # tobytes() veikia ir tuščiam masyvui (pvz. pradinis dekoderio kešas su ilgiu 0)
    data = to_js(memoryview(arr.tobytes()))
    return js.penklineTensor(_NP_TO_ORT[arr.dtype], data, to_js(list(arr.shape)))


def _from_js_tensor(tensor) -> np.ndarray:
    info = js.penklineTensorBytes(tensor)
    dtype = _ORT_TO_NP[info.type]
    dims = [int(d) for d in info.dims]
    return np.frombuffer(info.bytes.to_bytes(), dtype=dtype).reshape(dims).copy()


class OrtValue:
    """Tenzorius, laikomas arba kaip numpy masyvas, arba kaip JS ort.Tensor."""

    def __init__(self, array: np.ndarray | None = None, js_tensor=None) -> None:
        self._array = array
        self._js = js_tensor

    @staticmethod
    def ortvalue_from_numpy(array: np.ndarray, device_type: str = "cpu", device_id: int = 0) -> OrtValue:
        return OrtValue(array=np.ascontiguousarray(array))

    def numpy(self) -> np.ndarray:
        if self._array is None:
            self._array = _from_js_tensor(self._js)
        return self._array

    def js_tensor(self):
        if self._js is None:
            self._js = _to_js_tensor(self._array)
        return self._js

    def shape(self) -> list[int]:
        return list(self.numpy().shape)


class IOBinding:
    def __init__(self, session: InferenceSession) -> None:
        self._session = session
        self._inputs: dict[str, OrtValue] = {}
        self._output_names: list[str] = []
        self._outputs: list[OrtValue] = []

    def bind_cpu_input(self, name: str, array: np.ndarray) -> None:
        self._inputs[name] = OrtValue(array=np.ascontiguousarray(array))

    def bind_ortvalue_input(self, name: str, value: OrtValue) -> None:
        self._inputs[name] = value

    def bind_input(self, name, device_type, device_id, element_type, shape, buffer_ptr) -> None:
        raise NotImplementedError("bind_input naršyklėje nepalaikomas")

    def bind_output(self, name: str, *args, **kwargs) -> None:
        if name not in self._output_names:
            self._output_names.append(name)

    def bind_ortvalue_output(self, name: str, value: OrtValue) -> None:
        self.bind_output(name)

    def get_outputs(self) -> list[OrtValue]:
        return self._outputs

    def copy_outputs_to_cpu(self) -> list[np.ndarray]:
        return [o.numpy() for o in self._outputs]

    def clear_binding_inputs(self) -> None:
        self._inputs = {}

    def clear_binding_outputs(self) -> None:
        self._output_names = []

    def synchronize_inputs(self) -> None:
        pass

    def synchronize_outputs(self) -> None:
        pass


class InferenceSession:
    def __init__(self, path_or_bytes, sess_options=None, providers=None, provider_options=None,
                 **kwargs) -> None:
        name = os.path.basename(str(path_or_bytes))
        info = run_sync(js.penklineCreateSession(name))
        self._id = int(info.id)
        self._input_names = [str(n) for n in info.inputNames]
        self._output_names = [str(n) for n in info.outputNames]

    def get_inputs(self) -> list[_NodeArg]:
        return [_NodeArg(n) for n in self._input_names]

    def get_outputs(self) -> list[_NodeArg]:
        return [_NodeArg(n) for n in self._output_names]

    def get_providers(self) -> list[str]:
        return ["CPUExecutionProvider"]

    def io_binding(self) -> IOBinding:
        return IOBinding(self)

    def _run(self, inputs: dict[str, OrtValue], output_names: list[str]) -> list[OrtValue]:
        feeds = js.Object.new()
        for name, value in inputs.items():
            js.Reflect.set(feeds, name, value.js_tensor())
        result = run_sync(js.penklineRun(self._id, feeds, to_js(output_names)))
        return [OrtValue(js_tensor=result[i]) for i in range(len(output_names))]

    def run_with_iobinding(self, iobinding: IOBinding, run_options=None) -> None:
        names = iobinding._output_names or self._output_names
        iobinding._outputs = self._run(iobinding._inputs, names)

    def run(self, output_names, input_feed, run_options=None) -> list[np.ndarray]:
        names = list(output_names) if output_names else self._output_names
        inputs = {k: v if isinstance(v, OrtValue) else OrtValue(array=np.asarray(v))
                  for k, v in input_feed.items()}
        return [o.numpy() for o in self._run(inputs, names)]
