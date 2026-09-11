import React from 'react';
import { createRoot } from 'react-dom/client';
import { DealConversionModal } from '../../../src/components/pipeline/DealConversionModal';
import '../../../src/index.css';
const deal: any = {id:'9001',title:'Cliente de teste · Gestante + newborn',contact_name:'Cliente de teste',value:2500,client_id:1001,items:[],stage:'lead'};
const clients: any[] = [{id:1001,name:'Cliente de teste'}];
createRoot(document.getElementById('root')!).render(<main><h1>Ambiente de revisão — dados de exemplo</h1><DealConversionModal deal={deal} clients={clients} onClose={()=>{}} onConverted={()=>{}}/><pre id="submitted" aria-label="Dados enviados na simulação"/></main>);
