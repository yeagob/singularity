# Singularity

Una experiencia visual interactiva 3D que simula un agujero negro con deformación espacial volumétrica, construida con Three.js WebGPU y ray marching.

## Características

- **Deformación Espacial Volumétrica**: Simulación de agujero negro mediante ray marching con steering gravitacional
- **Visualización de Voz Reactiva**: El efecto visual responde en tiempo real al input del micrófono
  - Análisis de frecuencia FFT en 8 bandas
  - Graves modulan la intensidad gravitacional
  - Frecuencias medias afectan la turbulencia
  - Agudos expanden el ancho del efecto
  - Volumen general controla brillo y detalle
- **Motor de Renderizado**: Three.js WebGPU con Three.js Shading Language (TSL)
- **Post-procesamiento**: Bloom y efectos de composición
- **Ruido Procedural**: Simplex noise, curl noise y FBM para texturas orgánicas

## Instalación y Ejecución

```bash
npm i
npm run dev
```

## Tecnologías

- Three.js WebGPU
- Three.js Shading Language (TSL)
- Web Audio API
- Volumetric Ray Marching
- Procedural Noise Generation

## Contribuciones

- **[@SantiagoGameLover](https://github.com/SantiagoGameLover)** - Implementación de visualización de voz reactiva al micrófono

## Demo

https://github.com/user-attachments/assets/e7810d45-6113-4dfc-8884-5c9fbdeca65d
