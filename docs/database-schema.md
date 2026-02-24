# Diagrama de Base de Datos

## Diagrama ER (Mermaid)

> Para visualizar: copia el bloque mermaid y pegalo en [mermaid.live](https://mermaid.live)
> o instala la extension "Markdown Preview Mermaid Support" en VS Code y haz preview de este archivo.

```mermaid
erDiagram
    Parameter {
        int id PK
        varchar type
        varchar code
        varchar label
        varchar description
        boolean is_active
        int sort_order
        int parent_id FK
        timestamp created_at
        timestamp updated_at
    }

    Profile {
        uuid id PK
        varchar email UK
        varchar full_name
        varchar phone
        varchar avatar_url
        json metadata
        timestamp created_at
        timestamp updated_at
    }

    Subscription {
        uuid id PK
        uuid user_id FK,UK
        int type_id FK
        varchar name
        date start_date
        date end_date
        int max_users
        int max_companies
        boolean excel_reports
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }

    Company {
        uuid id PK
        uuid subscription_id FK
        varchar name
        varchar nit UK
        int sector_id FK
        varchar city
        varchar address
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }

    UserCompany {
        uuid id PK
        uuid user_id FK
        uuid company_id FK
        varchar role
        boolean is_active
        uuid invited_by FK
        timestamp joined_at
        timestamp created_at
        timestamp updated_at
    }

    Customer {
        uuid id PK
        uuid company_id FK
        int person_type_id FK
        varchar business_name
        varchar identification_number
        varchar legal_rep_name
        varchar legal_rep_id
        varchar economic_activity
        varchar email
        varchar phone
        varchar secondary_phone
        varchar city
        varchar address
        varchar commercial_ref1_name
        varchar commercial_ref1_contact
        varchar commercial_ref1_phone
        varchar commercial_ref2_name
        varchar commercial_ref2_contact
        varchar commercial_ref2_phone
        text observations
        uuid created_by FK
        uuid updated_by FK
        timestamp created_at
        timestamp updated_at
    }

    CreditStudy {
        uuid id PK
        uuid customer_id FK
        uuid company_id FK
        int status_id FK
        decimal requested_amount
        decimal approved_amount
        int term_months
        decimal interest_rate
        text notes
        date study_date
        date resolution_date
        uuid created_by FK
        uuid updated_by FK
        timestamp created_at
        timestamp updated_at
    }

    Parameter ||--o{ Parameter : "parent"
    Profile ||--o| Subscription : "tiene"
    Profile ||--o{ UserCompany : "pertenece a"
    Profile ||--o{ UserCompany : "invita a"
    Profile ||--o{ Customer : "crea"
    Profile ||--o{ Customer : "modifica"
    Profile ||--o{ CreditStudy : "crea"
    Profile ||--o{ CreditStudy : "modifica"
    Subscription ||--o{ Company : "habilita"
    Company ||--o{ UserCompany : "tiene usuarios"
    Company ||--o{ Customer : "tiene clientes"
    Company ||--o{ CreditStudy : "tiene estudios"
    Customer ||--o{ CreditStudy : "tiene estudios"
    Parameter ||--o{ Subscription : "tipo suscripcion"
    Parameter ||--o{ Company : "sector trabajo"
    Parameter ||--o{ Customer : "tipo persona"
    Parameter ||--o{ CreditStudy : "estado estudio"
```

## Como visualizar

1. **mermaid.live** (recomendado): Ve a [mermaid.live](https://mermaid.live), pega el bloque de codigo mermaid
2. **VS Code**: Instala la extension "Markdown Preview Mermaid Support", luego abre este archivo y presiona `Ctrl+Shift+V`
3. **GitHub**: Si subes este archivo a GitHub, el diagrama se renderiza automaticamente
