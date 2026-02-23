/**
 * Init Templates
 *
 * Generates starter .air files for `air init`.
 */

export function generateInitTemplate(appName: string, fullstack: boolean): string {
  if (fullstack) {
    return `@app:${appName}
  @state{items:[{id:int,text:str,done:bool}],input:str}

  @db{
    Item{id:int:primary:auto,text:str:required,done:bool:default(false),created_at:datetime:auto}
  }

  @api(
    CRUD:/items>~db.Item
  )

  @style(accent:#6366f1,radius:8px)

  @ui(
    header>"${capitalize(appName)}"
    row(
      input:text>#input
      btn:primary:!add({text:#input,done:false})>"Add"
    )
    *item(
      row(
        check:#item.done
        text>#item.text
        btn:icon:!del(#item.id)
      )
    )
  )

  @persist:localStorage(items)
`;
  }

  return `@app:${appName}
  @state{items:[{id:int,text:str,done:bool}],input:str,filter:enum(all,active,done)}

  @style(accent:#6366f1,radius:8px)

  @ui(
    header>"${capitalize(appName)}"
    row(
      input:text>#input
      btn:primary:!add({text:#input,done:false})>"Add"
    )
    tabs>filter.set
    *item(
      row(
        check:#item.done
        text>#item.text
        btn:icon:!del(#item.id)
      )
    )
    footer>text>"#items|!done.length items left"
  )

  @persist:localStorage(items)
`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
