# Laboratorio 3. Instrumentación y observación de un servicio

Este repositorio constituye el punto de partida del Laboratorio 3 de Métricas de Software. Contiene un sistema funcional formado por `notifications-api` y `delivery-provider`, además de Prometheus, Grafana, scripts de carga y validadores.

La telemetría de aplicación está deliberadamente incompleta. El trabajo consiste en diseñar y completar la instrumentación, consultar la evidencia producida e interpretar el comportamiento del sistema.

## Creación del repositorio de trabajo

1. Utilice **Use this template** en GitHub.
2. Cree un repositorio **privado** para la pareja.
3. Agregue como colaboradores al otro integrante y al docente según las indicaciones publicadas en Moodle.
4. Realice todo el trabajo en ese repositorio.
5. En Moodle entregue la URL del repositorio y el SHA del commit que constituye la entrega.

No utilice un fork público.

## Requisitos

- Docker con Docker Compose.
- Node.js 22 o posterior.
- npm.
- `jq`.

## Preparación

```bash
npm install
npm run build
npm run reset
docker compose up --build -d
```

Compruebe:

```text
notifications-api   http://localhost:3000
Grafana             http://localhost:3001

delivery-provider  http://localhost:3002
Prometheus          http://localhost:9090
```

Grafana utiliza las credenciales de laboratorio:

```text
usuario: admin
contraseña: admin
```

Prometheus ya está provisionado como datasource. El dashboard y la regla de alerta deben ser construidos por la pareja.

## Archivos que pueden modificarse

La evaluación se concentra en:

```text
services/notifications-api/src/notifications.ts
services/notifications-api/src/metrics.ts
services/delivery-provider/src/delivery.ts
services/delivery-provider/src/metrics.ts
LAB3.md
evidence/
```

No deben modificarse la infraestructura de `request_id`, los scripts de soporte, `compose.yaml`, la configuración de Prometheus ni el provisioning de Grafana.

## Scripts disponibles

```bash
npm run scenario
npm run probe:retry
npm run probe:privacy
npm run validate
npm run reset
```

`npm run scenario` ejecuta las fases A-E del experimento. `probe:retry` genera una operación recuperada mediante reintento. `probe:privacy` introduce valores deliberadamente sensibles para comprobar que no sean persistidos.

El estado inicial está diseñado para que `npm run validate` reporte fallos de instrumentación. La validación completa se alcanza únicamente después de implementar la solución y generar la evidencia requerida.

## Evidencia de Grafana

La entrega debe incluir:

```text
evidence/grafana-dashboard.json
evidence/dashboard.png
evidence/alert.png
```

La captura `alert.png` debe mostrar la regla en estado `Alerting` durante la fase C. En `LAB3.md` deben quedar documentadas la expresión PromQL de la regla, el umbral, el intervalo de evaluación, el período pendiente y la justificación de esos parámetros.

## Documento de entrega

Complete `LAB3.md`. No se requiere un informe PDF adicional ni un archivo `validation.txt`.
