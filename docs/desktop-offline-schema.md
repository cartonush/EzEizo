# EzEizo — מבנה נתונים ראשוני לגרסת מחשב מקומית

המסמך מפרט שמות טבלאות ועמודות בלבד. הוא מתאים לתכנון SQLite, ואפשר להשתמש בו גם לתכנון Access. `ID` הוא מזהה קבוע לכל רשומה; `FormID`, `UserID` ו־`AircraftID` מחברים בין הטבלאות. לכל טכנאי שמקבל עותק תקלה יש `FormID` משלו, גם כשהמספר הסידורי משותף.

| טבלה | עמודות |
| --- | --- |
| `Users` | `UserID`, `DisplayName`, `Email`, `Role`, `Active`, `CreatedAt`, `DeletedAt`, `UpdatedAt` |
| `Squadrons` | `SquadronID`, `Name` |
| `Aircraft` | `AircraftID`, `SquadronID`, `AircraftNumber`, `DefaultEWSuite`, `Active` |
| `Locations` | `LocationID`, `SquadronID`, `ShelterName`, `WorkshopName`, `Active` |
| `Systems` | `SystemID`, `SystemName`, `SystemCode`, `Active` |
| `Forms` | `FormID`, `SerialNumber`, `FormKind`, `Status`, `SquadronID`, `LocationID`, `CreatedByUserID`, `OpenedAt`, `SubmittedAt`, `ClosedAt`, `ReviewedAt`, `UpdatedAt` |
| `FaultDetails` | `FormID`, `AircraftID`, `SystemID`, `EWSuite`, `FaultDescription`, `RepairDescription`, `ArrivalTime`, `CompletionTime`, `Action11Outcome` |
| `KeyLoadDetails` | `FormID`, `WorkDate`, `WorkTime`, `Period` |
| `FormParticipants` | `ParticipantID`, `FormID`, `UserID`, `ParticipantRole`, `Position`, `AssignedAt` |
| `KeyLoadAircraft` | `RowID`, `FormID`, `AircraftID`, `BlueRequested`, `BlueCompleted`, `ShachRequested`, `ShachCompleted`, `ManagerNotes`, `TechnicianNotes` |
| `FormActions` | `ActionID`, `FormID`, `ActionNumber`, `Outcome`, `ActionTime` |
| `FormUnits` | `UnitRowID`, `FormID`, `Direction`, `UnitName`, `SerialNumber` |
| `FormTools` | `ToolRowID`, `FormID`, `ToolName`, `ToolNumber`, `Notes` |
| `FormMaterials` | `MaterialRowID`, `FormID`, `Category`, `Description`, `RemovedFrom`, `QuantityIn`, `QuantityOut`, `Quantity`, `Mascha`, `RejectionReason`, `Notes` |
| `FormInspections` | `InspectionID`, `FormID`, `Phase`, `InspectorPersonalNumber`, `ToolsOfficerName`, `LeadName`, `DepartureTime` |
| `FormSignatures` | `SignatureID`, `FormID`, `InspectionID`, `Purpose`, `SignerUserID`, `SignedAt`, `FilePath` |
| `FormNotes` | `NoteID`, `FormID`, `AuthorUserID`, `AuthorRole`, `Content`, `CreatedAt` |
| `AircraftConstants` | `ConstantID`, `AircraftID`, `GroupName`, `ConstantName`, `Value`, `UpdatedByUserID`, `UpdatedAt` |
| `FormEvents` | `EventID`, `FormID`, `EventName`, `ActorUserID`, `EventAt`, `Details` |
| `SyncQueue` | `ChangeID`, `EntityName`, `RecordID`, `Operation`, `ChangedAt`, `SyncStatus`, `AttemptCount` |

## כללים חשובים לתכנון

- `AircraftNumber` שומר ערכים כגון `034` כפי שהם, כולל האפס המוביל.
- היסטוריית ארז כחול ושחק מופקת בנפרד מהטפסים הסגורים ומשורות `KeyLoadAircraft`. אין צורך בטבלת היסטוריה שמשותפת לשני סוגי המפתחות.
- שורות ריקות בטבלאות הכלים, היחידות והקשיחים אינן נשמרות.
- חתימות הן קבצים מקומיים; `FilePath` מפנה לקובץ בתיקיית הנתונים של האפליקציה, והגיבוי כולל גם אותם.
- `FormEvents` שומר פתיחה, הגשה, סגירה, החזרה לעריכה וסגירה מחדש. `SyncQueue` יאפשר בעתיד לשלוח שינויים לשרת בלי להחליף מזהים מקומיים.
- דוחות אינם טבלאות נפרדות. הם מופקים מהטפסים, המשתתפים, המטוסים והאירועים.
