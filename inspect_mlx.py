try:
    import mlx_audio
    from mlx_audio.tts.utils import load_model
    import inspect
    print(f"mlx_audio location: {mlx_audio.__file__}")
    print(f"load_model source:\n{inspect.getsource(load_model)}")
except Exception as e:
    print(f"Error: {e}")
