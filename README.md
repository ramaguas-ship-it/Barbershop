# Barbershop — Sistema de Gestión para Barbería

Proyecto integrador de **Administración de Bases de Datos**
Universidad Técnica Estatal de Quevedo · Ingeniería de Software · Quinto nivel, Paralelo A

**Docente:** Ing. Cordero Bazurto José Steven

## Descripción

Barbershop es una aplicación web para una barbería de una sola sucursal que centraliza la gestión de citas, clientes, cobros (incluido el pago en línea), caja, inventario y reportes de ventas.

**Problema que resuelve:** la agenda en cuaderno o mensajes provoca cruces de horario, citas olvidadas y clientes que no asisten; además, el inventario, los cobros y las ventas se controlan a mano, lo que genera errores y falta de información para decidir.

**Regla fundamental:** no se permite reservar un horario ocupado para el mismo barbero, y si una cita ya fue pagada en línea, el sistema bloquea cualquier intento de cobrarla de nuevo.

**Estado:** etapa de especificación de requisitos. Aún no hay código implementado.

## Integrantes

- Amagua Sacon Robyn Willian
- Barrionuevo Fuentes Carlos Daniel
- Marcillo Ponce Alberto Jeanpool
- Mesias Quijije Jhon Alexander
- Vera Gomez Anthony Alfredo

## Alcance

**Incluye:** una sola sucursal, gestión de citas, servicios, clientes, inventario, cobros (efectivo, transferencia, tarjeta en local y pago en línea), caja y reportes.

**Excluye:** comisiones, multisucursal, aplicación móvil nativa y programa de fidelización.

### Módulos principales y funcionalidades previstas

| Módulo | Funcionalidades | Versión |
|---|---|---|
| Autenticación y catálogo | Registro del cliente, inicio de sesión con acceso por roles (administrador, barbero, cliente), gestión de barberos y servicios | V1 |
| Citas y agenda | Reserva de citas con validación de disponibilidad, agenda del barbero y cambio de estado de la cita | V1 |
| Inventario | Gestión de productos, proveedores e ingresos de stock | V1 |
| Cobros y pagos | Pago en línea mediante pasarela, cobro de atenciones y productos, descuento automático de stock con alerta de mínimo | V1 |
| Gestión de citas complementaria e historial | Reprogramar o cancelar citas, historial de servicios y pagos del cliente | V2 |
| Caja y reportes | Apertura y cierre de caja, reportes de ventas por período, barbero y método de pago, exportación a PDF | V2 |

## Tecnologías

- Base de datos: PostgreSQL
- Interfaz y lógica de negocio: por definir
- Documentación: LaTeX
